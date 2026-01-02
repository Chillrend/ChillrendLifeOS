const { PlaneClient } = require('@makeplane/plane-node-sdk');
const { marked } = require('marked');
require('dotenv').config();

class PlaneService {
    constructor(apiKey) {
        this.plane = new PlaneClient({ 
            apiKey, 
            baseUrl: process.env.PLANE_BASE_URL 
        });
        this.workspaceId = process.env.PLANE_WORKSPACE_ID;
        this.projectId = process.env.PLANE_PROJECT_ID;
    }

    async getTasks() {
        try {
            const response = await this.plane.workItems.list(this.workspaceId, this.projectId);
            return response.results || [];
        } catch (error) {
            console.error('Error fetching tasks from Plane:', error);
            throw new Error('Could not fetch tasks from Plane.');
        }
    }

    async createTask(taskDetails) {
        try {
            const payload = {
                name: taskDetails.title,
                description_html: marked(taskDetails.notes || ''),
                state: taskDetails.stateId,
                labels: taskDetails.labelIds,
                start_date: new Date().toISOString().split('T')[0],
                assignees: ['68586bff-d00b-4e5a-9c4c-3b9b2a2f5091'],
            };

            if (taskDetails.priority) {
                payload.priority = taskDetails.priority;
            }

            return await this.plane.workItems.create(this.workspaceId, this.projectId, payload);
        } catch (error) {
            console.error('Error creating task in Plane:', JSON.stringify(error, null, 2));
            throw new Error('Could not create task in Plane.');
        }
    }

    async getComments(issueId) {
        try {
            const response = await this.plane.workItems.comments.list(this.workspaceId, this.projectId, issueId);
            return response.results || [];
        } catch (error) {
            console.error(`Error fetching comments for issue ${issueId} from Plane:`, error);
            throw new Error(`Could not fetch comments for issue ${issueId}.`);
        }
    }

    async getStates() {
        try {
            const response = await this.plane.states.list(this.workspaceId, this.projectId);
            return response.results || [];
        } catch (error) {
            console.error('Error fetching states from Plane:', error);
            return [];
        }
    }

    async getLabels() {
        try {
            const response = await this.plane.labels.list(this.workspaceId, this.projectId);
            return response.results || [];
        } catch (error) {
            console.error('Error fetching labels from Plane:', error);
            return [];
        }
    }
}

module.exports = PlaneService;
