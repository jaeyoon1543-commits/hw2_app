// All page and API requests pass through APP_PASSWORD authentication.
const {createApp}=require('../server.cjs');
const {app}=createApp();
module.exports=app;
