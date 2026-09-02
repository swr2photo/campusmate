const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Ensure firebase-admin is available
initializeApp({
  credential: applicationDefault(),
  projectId: 'campusmate-7f1ab'
});

async function updateActionUrl() {
  try {
    const configManager = getAuth().projectConfigManager();
    const currentConfig = await configManager.getProjectConfig();
    
    await configManager.updateProjectConfig({
      passwordResetEmailTemplate: {
        ...currentConfig.passwordResetEmailTemplate,
        customized: true,
        actionUrl: 'https://campusmate-7f1ab.web.app/reset.html'
      }
    });
    console.log('Successfully updated Action URL to https://campusmate-7f1ab.web.app/reset.html');
  } catch (error) {
    console.error('Error updating Action URL:', error);
  }
}

updateActionUrl();
