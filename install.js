const cron = require('node-cron');
const {run} = require('./main.js');
cron.schedule('0 0 23,0-5 * * *', run); // by UTC