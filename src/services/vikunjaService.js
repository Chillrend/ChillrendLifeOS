const axios = require('axios');

class VikunjaService {
  constructor() {
    this.apiUrl = process.env.VIKUNJA_API_URL.replace(/\/$/, ''); // Remove trailing slash if present
    this.token = process.env.VIKUNJA_API_TOKEN;
    this.projectId = process.env.VIKUNJA_PROJECT_ID;

    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Map text priority to Vikunja priority integers (1-5 in some versions, or 1-4).
   * 1 = Normal/Low, 2 = Medium, 3 = High, 4 = Urgent/Critic, 5 = Critical
   */
  mapPriority(priorityStr) {
    if (!priorityStr) return 1;
    switch (priorityStr.toLowerCase()) {
      case 'urgent': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 1;
    }
  }

  /**
   * Fetch all buckets for the project to match names dynamically or verify IDs
   */
  async getBuckets() {
    try {
      // In Vikunja, buckets are retrieved for a specific project
      const response = await this.client.get(`/projects/${this.projectId}/buckets`);
      return response.data || [];
    } catch (error) {
      console.error('[Vikunja] Error fetching buckets:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Fetch all labels/tags in Vikunja
   */
  async getLabels() {
    try {
      const response = await this.client.get('/labels');
      return response.data || [];
    } catch (error) {
      console.error('[Vikunja] Error fetching labels:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Create a label if it does not exist
   */
  async createLabel(title) {
    try {
      const response = await this.client.put('/labels', { title, hex_color: '3b82f6' });
      return response.data;
    } catch (error) {
      console.error(`[Vikunja] Error creating label ${title}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get tasks in the configured project
   */
  async getTasks(filters = {}) {
    try {
      // Fetch tasks for the project
      const response = await this.client.get(`/projects/${this.projectId}/tasks`, { params: filters });
      return response.data || [];
    } catch (error) {
      console.error('[Vikunja] Error fetching tasks:', error.response?.data || error.message);
      throw new Error('Could not fetch tasks from Vikunja.');
    }
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId) {
    try {
      const response = await this.client.get(`/tasks/${taskId}`);
      return response.data;
    } catch (error) {
      console.error(`[Vikunja] Error fetching task ${taskId}:`, error.response?.data || error.message);
      throw new Error(`Could not fetch task ${taskId} from Vikunja.`);
    }
  }

  /**
   * Create a new task in the project
   */
  async createTask(taskDetails) {
    try {
      const priorityInt = this.mapPriority(taskDetails.priority);
      const payload = {
        title: taskDetails.title,
        description: taskDetails.notes || '',
        priority: priorityInt,
        // In Vikunja Kanban, you associate a task with a bucket
        bucket_id: taskDetails.bucketId ? parseInt(taskDetails.bucketId, 10) : undefined,
        start_date: taskDetails.startDate || undefined,
        due_date: taskDetails.dueDate || undefined,
      };

      console.log('[Vikunja] Creating task with payload:', payload);
      // Create task inside the project
      const response = await this.client.put(`/projects/${this.projectId}/tasks`, payload);
      const createdTask = response.data;

      // Handle labels association
      if (taskDetails.tags && taskDetails.tags.length > 0) {
        const availableLabels = await this.getLabels();
        for (const tagName of taskDetails.tags) {
          // Find or create label
          let label = availableLabels.find(l => l.title.toLowerCase() === tagName.toLowerCase());
          if (!label) {
            label = await this.createLabel(tagName);
          }
          if (label && label.id) {
            await this.associateLabelToTask(createdTask.id, label.id);
          }
        }
      }

      return createdTask;
    } catch (error) {
      console.error('[Vikunja] Error creating task:', error.response?.data || error.message);
      throw new Error('Could not create task in Vikunja.');
    }
  }

  /**
   * Link a label/tag to a task
   */
  async associateLabelToTask(taskId, labelId) {
    try {
      await this.client.put(`/tasks/${taskId}/labels`, { label_id: labelId });
    } catch (error) {
      console.error(`[Vikunja] Error associating label ${labelId} to task ${taskId}:`, error.response?.data || error.message);
    }
  }

  /**
   * Update task's bucket / state (moves task on Kanban)
   */
  async updateTaskBucket(taskId, bucketId) {
    try {
      const payload = {
        bucket_id: parseInt(bucketId, 10)
      };
      // In Vikunja, to move a task to a bucket in Kanban, we update the task
      const response = await this.client.post(`/tasks/${taskId}`, payload);
      return response.data;
    } catch (error) {
      console.error(`[Vikunja] Error updating task ${taskId} bucket to ${bucketId}:`, error.response?.data || error.message);
      throw new Error('Could not update task bucket in Vikunja.');
    }
  }

  /**
   * Update arbitrary fields of a task
   */
  async updateTask(taskId, fields) {
    try {
      const response = await this.client.post(`/tasks/${taskId}`, fields);
      return response.data;
    } catch (error) {
      console.error(`[Vikunja] Error updating task ${taskId}:`, error.response?.data || error.message);
      throw new Error(`Could not update task ${taskId} in Vikunja.`);
    }
  }

  /**
   * Mark task as done / undone
   */
  async updateTaskDone(taskId, isDone) {
    try {
      const response = await this.client.post(`/tasks/${taskId}`, { done: isDone });
      return response.data;
    } catch (error) {
      console.error(`[Vikunja] Error setting done=${isDone} for task ${taskId}:`, error.response?.data || error.message);
      throw new Error('Could not update task completion in Vikunja.');
    }
  }

  /**
   * Add a comment to a task
   */
  async addComment(taskId, commentText) {
    try {
      const response = await this.client.put(`/tasks/${taskId}/comments`, { comment: commentText });
      return response.data;
    } catch (error) {
      console.error(`[Vikunja] Error adding comment to task ${taskId}:`, error.response?.data || error.message);
      throw new Error('Could not add comment to task in Vikunja.');
    }
  }
}

module.exports = VikunjaService;
