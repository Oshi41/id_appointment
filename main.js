const path = require('path');
const os = require('os');
const fs = require('fs');
const webdriverio = require('webdriverio');
const {createWorker, OEM} = require('tesseract.js');
const {findmyphone} = require("find-my-iphone");
const readline = require('readline');
findmyphone.getDevicesAsync = () => new Promise((resolve, reject) => {
    findmyphone.getDevices((error, devices) => {
        if (error)
            return reject(error);
        return resolve(devices);
    });
});
findmyphone.alertDeviceAsync = (id) => new Promise((resolve, reject) => {
    findmyphone.alertDevice(id, (error) => {
        if (error)
            return reject(error);
        return resolve();
    });
});

const conf_path = path.join(os.homedir(), 'appointment.conf');
const settings_path = path.join(os.homedir(), 'settings.conf');

const captcha = {
    ctl00_MainContent_imgSecNum: {
        input: 'ctl00_MainContent_txtCode',
        regex: /[0-9]{6}/g,
    },
};
const form_appointment_fill = {
    ctl00_MainContent_txtID: 'id',
    ctl00_MainContent_txtUniqueID: 'cd',
};

/**
 * @type {WebdriverIO.Browser}
 */
let browser;
/**
 * @type {Tesseract.Worker}
 */
let tesseract;
const rl = readline.createInterface(process.stdin, process.stdout);
let settings;

const wait = time => new Promise(resolve => {
    setTimeout(() => {
        resolve();
    }, time);
});

/**
 * @param browser {WebdriverIO.Browser}
 * @param tesseract {Tesseract.Worker}
 * @return {Promise<void>}
 */
const fill_if_needed = async (browser, form_fill) => {
    for (let [key, value] of Object.entries(form_fill)) {
        let selector = await browser.$('#' + key);
        if (!selector || selector.error) {
            console.log('Cannot find element: #' + key, selector?.error);
            continue;
        }
        if (typeof value == 'string') {
            await selector.setValue(value);
            continue;
        }
        if (typeof value == 'object') {
            for (let [k, v] of Object.entries(value))
                await selector.selectByAttribute(k, v);
            continue;
        }
    }
};

/**
 * @param browser {WebdriverIO.Browser}
 * @param tesseract {Tesseract.Worker}
 * @return {Promise<void>}
 */
const solve_capture = async (browser, tesseract) => {
    let next = async () => {
        await browser.$('#ctl00_MainContent_ButtonA').click();
    };
    for (let [img_key, {input, regex}] of Object.entries(captcha)) {
        let [img_e, input_e] = await Promise.all([img_key, input].map(x => browser.$('#' + x)));
        if (img_e.error || input_e.error) {
            console.log('Cannot find captcha:', img_key, input);
            continue;
        }
        let filepath = path.join(os.tmpdir(), 'captcha.png');
        while (true)
        {
            try {
                await img_e.saveScreenshot(filepath);
                let res = await tesseract.recognize(filepath, {}, {});
                let result = res.data.text.replace(/[^0-9]/g, '');
                await input_e.setValue(result);
                await wait(1000 * 3); // human immitation
                if (!regex.test(result)) {
                    console.log('wrong recognition: ', res.data.text, '->', result);
                    throw new Error('Cannot solve capture');
                }
                await next(); // capture confirmation
                await wait(300);
                let e = (await browser.$('#' + img_key)).error;
                if (!e)
                    throw new Error('Cannot solve capture');
                return true;
            } catch (e) {
                console.error('Error during capture solving:', e);
                await next(); // new capture
            } finally {
                fs.rmSync(filepath);
            }
        }
    }
}

const make_appointment = async (fill_form) => {
    await browser.navigateTo('https://bangkok.kdmid.ru/queue/visitor.aspx');
    await fill_if_needed(browser, fill_form);
    console.log('filled information');

    await solve_capture(browser, tesseract);

    while (true) {
        try {
            let link = await browser.$('#ctl00_MainContent_HyperLinkNext');
            await link.waitForClickable({timeout: 3 * 1000, interval: 300});
            await link.click();
            break;
        } catch (e) {
            console.log('Error during private confirmation:', e);
        }
    }

    while (true) {
        try {
            await browser.$('//a[contains(text(), "10-летний")]').click();
            await browser.$('#ctl00_MainContent_RList_0').click();
            await browser.$('#ctl00_MainContent_CheckBoxID').click();
            await browser.$('#ctl00_MainContent_ButtonA').click();
            break;
        } catch (e) {
            console.log('Error during selecting passport:', e);
        }
    }

    {

        let elem = await browser.$('#center-panel > div:nth-child(9) > a');
        if (!elem.error) {
            return console.log('Already registered');
        }

    }

    while (true) {
        try {
            let elem = await browser.$('#ctl00_MainContent_CheckBoxList1_0');
            await elem.waitForExist({timeout: 2 * 1000, interval: 300});
            await elem.click();
            await browser.$('#ctl00_MainContent_ButtonQueue').click();
            break;
        } catch (e) {
            console.log('Error during scheduling passport:', e);
        }
    }

    while (true) {
        try {
            let elem = await browser.$('//p[contains(., "Защитный код")]');
            await elem.waitForExist({timeout: 2 * 1000, interval: 300});
            let txt = await elem.getText();
            let splitted = txt.split('\n');
            let url = splitted[splitted.length - 1].trim();
            if (!fs.existsSync(conf_path))
                fs.writeFileSync(conf_path, '{}', 'utf-8');
            let json = JSON.parse(fs.readFileSync(conf_path));
            json[url.toString()] = {_ts: new Date(),};
            fs.writeFileSync(conf_path, JSON.stringify(json, null, 2), 'utf-8');
            break;
        } catch (e) {
            console.log('Error during confirmation:', e);
        }
    }
};

const send_alert = async () => {
    let device = (await findmyphone.getDevicesAsync())[0];
    await findmyphone.alertDeviceAsync(device.id);
}

/**
 * @return {Promise<void>}
 */
const check_free_time = async (config) => {
    for (let url of Object.keys(config).map(x => new URL(x))) {
        await browser.navigateTo(url.toString());
        for (let [selector, param] of Object.entries(form_appointment_fill)) {
            let elem = await browser.$('#' + selector)
            let value = url.searchParams.get(param);
            await elem.setValue(value);
        }
        await solve_capture(browser, tesseract);
        await wait(300);

        let elem = await browser.$('//h3[contains(., "подтверждения")]');
        if (!elem.error) {
            console.log('You should confirm by email');
            continue;
        }
        elem = await browser.$('#ctl00_MainContent_ButtonB');
        await elem.waitForExist({timeout: 1000 * 3, interval: 300});
        await elem.click();

        let elems = await browser.$$('td[disabled]:not([disabled="disabled"])');
        if (elems.length) {
            await send_alert();
            await wait(Number.MAX_SAFE_INTEGER);
        } else {
            console.log('No free time');
        }
    }
}

const set_settings = async (settings) => {
    let question = txt => new Promise(resolve => {
        rl.question(txt+':\n', answer => resolve(answer));
    });

    settings.appointment = {
        ctl00_MainContent_txtFam: await question('Введи свою фамилию'),
        ctl00_MainContent_txtIm: await question('Введи своё имя'),
        ctl00_MainContent_txtOt: await question('Введи своё отчество'),
        ctl00_MainContent_txtTel: await question('Введи свой телефон'),
        ctl00_MainContent_txtEmail: await question('Введи свою почту'),
        ctl00_MainContent_TextBox_Year: await question('Введи год своего рождения'),
        ctl00_MainContent_DDL_Day: await question('Введи день своего рождения в формате 01-31'),
        ctl00_MainContent_DDL_Month: await question('Введи месяц своего рождения в формате 01-12'),
        ctl00_MainContent_DDL_Mr: await question('Введи свой пол в формате MS/MR'),
    };
    settings.apple = {
        apple_id: await question('Введи свой AppleID для уведомления о новых записях'),
        password: await question('Введи пароль от AppleID для уведомления о новых записях'),
    }

    return settings;
};

const run = async () => {
    if (!fs.existsSync(settings_path)) {
        settings = await set_settings({});
        fs.writeFileSync(settings_path, JSON.stringify(settings, null, 2), 'utf-8');
    } else {
        settings = JSON.parse(fs.readFileSync(settings_path, 'utf-8'));
    }

    Object.assign(findmyphone, settings.apple);

    browser = await webdriverio.remote({
        isChrome: true,
        capabilities: {browserName: 'chrome'},
    });
    console.log('Initialized browser');
    tesseract = await createWorker();
    await tesseract.loadLanguage('eng');
    await tesseract.initialize(['eng'], OEM.DEFAULT, {
        load_number_dawg: '1',
    });
    await tesseract.setParameters({
        tessedit_char_whitelist: '0123456789',
    });
    console.log('Tesseract initialized');

    let config = JSON.parse(fs.readFileSync(conf_path, 'utf-8'));
    if (Object.keys(config).length)
        await check_free_time(config);
    else
        await make_appointment(settings.appointment);


    await browser.closeWindow();
    process.exit();
}

if (!module.parent)
    run();

module.exports = {run};