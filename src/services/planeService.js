const { PlaneClient } = require('@makeplane/plane-node-sdk');

const PLANE_WORKSPACE_ID = 'chillrends-personal-workspace';
const PLANE_PROJECT_ID = '75fc170a-14d2-4d52-8572-42c9b05a5779';

class PlaneService {
    constructor(apiKey) {
        this.plane = new PlaneClient({ apiKey });
    }

    async getTasks() {
        try {
            const response = await this.plane.workItems.list(PLANE_WORKSPACE_ID, PLANE_PROJECT_ID);
            return response.results || [];
        } catch (error) {
            console.error('Error fetching tasks from Plane:', error);
            throw new Error('Could not fetch tasks from Plane.');
        }
    }

    async createTask(taskDetails) {
        try {
            return await this.plane.workItems.create(PLANE_WORKSPACE_ID, PLANE_PROJECT_ID, {
                name: taskDetails.title,
                description: taskDetails.notes || '',
            });
        } catch (error) {
            console.error('Error creating task in Plane:', error);
            throw new Error('Could not create task in Plane.');
        }
    }

    async getComments(issueId) {
        try {
            const response = await this.plane.workItems.comments.list(PLANE_WORKSPACE_ID, PLANE_PROJECT_ID, issueId);
            return response.results || [];
        } catch (error) {
            console.error(`Error fetching comments for issue ${issueId} from Plane:`, error);
            throw new Error(`Could not fetch comments for issue ${issueId}.`);
        }
    }
}

module.exports = PlaneService;
