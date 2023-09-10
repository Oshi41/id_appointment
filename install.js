const cron = require('node-cron');
const {run} = require('./main.js');

let add = Math.floor(new Date().getTimezoneOffset() / 60);
let to_local = (n)=>{
    let res = n + add;
    if (res < 0)
        res += 24;
    if (res > 0)
        res %= 24;
    return res;
}
let h_schedule = `${to_local(23, add)}-${to_local(5)}`; // by UTC
let schedule = `0 0 ${h_schedule} * * *`;

cron.schedule(schedule, run);