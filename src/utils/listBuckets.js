require('dotenv').config();
const VikunjaService = require('../services/vikunjaService');

async function listBuckets() {
  console.log('🤖 Connecting to Vikunja dynamically to retrieve all Kanban views and buckets...');
  
  if (!process.env.VIKUNJA_API_URL || !process.env.VIKUNJA_API_TOKEN || !process.env.VIKUNJA_PROJECT_ID) {
    console.error('❌ Error: Please ensure VIKUNJA_API_URL, VIKUNJA_API_TOKEN, and VIKUNJA_PROJECT_ID are set in your .env file.');
    process.exit(1);
  }

  try {
    const vikunja = new VikunjaService();
    
    // Fetch project details
    const projectRes = await vikunja.client.get(`/projects/${vikunja.projectId}`);
    console.log(`\n📂 Project: "${projectRes.data.title}" (ID: ${projectRes.data.id})`);

    // Fetch views
    const viewsRes = await vikunja.client.get(`/projects/${vikunja.projectId}/views`);
    const views = viewsRes.data || [];

    const kanbanViews = views.filter(v => v.title.toLowerCase().includes('kanban') || v.view_type === 'kanban');
    
    if (kanbanViews.length === 0) {
      console.log('⚠️ No Kanban views found in this project. Please create a Kanban view in Vikunja first.');
      return;
    }

    for (const view of kanbanViews) {
      console.log(`\n==================================================`);
      console.log(`📋 Buckets for Kanban View: "${view.title}" (ID: ${view.id})`);
      console.log(`==================================================`);
      
      const bucketsRes = await vikunja.client.get(`/projects/${vikunja.projectId}/views/${view.id}/buckets`);
      const buckets = bucketsRes.data || [];

      if (buckets.length === 0) {
        console.log('   (This view has no buckets)');
      } else {
        buckets.forEach(bucket => {
          console.log(`📌 Bucket Title: "${bucket.title}"`);
          console.log(`   └─ ID: ${bucket.id}`);
          console.log(`   └─ Position: ${bucket.position}\n`);
        });
      }
    }
    
    console.log('==================================================');
    console.log('Successfully retrieved all buckets!');

  } catch (error) {
    console.error('❌ Error fetching buckets:', error.response?.data || error.message);
  }
}

listBuckets();
