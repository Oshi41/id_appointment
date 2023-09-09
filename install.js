const cron = require('node-cron');
const {run} = require('./main.js');
cron.schedule('0 0 6-9 * * *', run);