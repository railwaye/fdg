// =======================================================================
let socket;
let currentHashedId = null; // वर्तमान उपयोगकर्ता की यूनिक आईडी को स्टोर करने के लिए

// ✨ यह ज़रूरी हिस्सा जोड़ा गया है ✨
// एक्सटेंशन शुरू होते ही स्टोरेज से ID लोड करने की कोशिश करें
chrome.storage.local.get('hashedUserId', (data) => {
    if (data.hashedUserId) {
        currentHashedId = data.hashedUserId;
        console.log('स्टोरेज से पुरानी Hashed ID लोड की गई:', currentHashedId);
    }
});


function connectToVps() {
    // 👇 यहाँ 'YOUR_VPS_IP_OR_NGROK_URL' को अपने पते से बदलें
    // उदाहरण: 'ws://123.45.67.89:8080' या 'wss://your-id.ngrok-free.app'
    const vpsAddress = 'wss://api.verifyotp.xyz'; // यहाँ अपना ngrok URL डालें

    console.log(`Connecting to VPS at ${vpsAddress}...`);
    socket = new WebSocket(vpsAddress);

    socket.onopen = function(event) {
        console.log('✅ VPS WebSocket से सफलतापूर्वक कनेक्ट हुआ।');
        // कनेक्ट होते ही अपनी पहचान (यूजर आईडी) भेजें
        if (currentHashedId) {
            socket.send(JSON.stringify({ type: 'register', userId: currentHashedId }));
        }
    };

    socket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('📩 VPS से OTP मिला:', data);
            if (data.otp) {
                sendOtpToContentScript(data.otp);
            }
        } catch (e) {
            console.error("VPS से मिला संदेश पार्स करने में विफल:", e);
        }
    };

    socket.onclose = function(event) {
        console.log('🔌 VPS WebSocket से कनेक्शन बंद हो गया। 1 सेकंड में फिर से कनेक्ट करने का प्रयास किया जा रहा है...');
        setTimeout(connectToVps, 1000); // कनेक्शन टूटने पर फिर से प्रयास करें
    };

    socket.onerror = function(error) {
        console.error('WebSocket Error:', error);
    };
}

// एक्सटेंशन शुरू होते ही कनेक्शन की प्रक्रिया शुरू करें
connectToVps();

function sendOtpToContentScript(otp) {
    // हमेशा उस समय की सक्रिय और वर्तमान विंडो की टैब को खोजें
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0] && tabs[0].id) {
            const activeTabId = tabs[0].id;
            console.log(`सक्रिय टैब (ID: ${activeTabId}) को OTP (${otp}) भेजा जा रहा है।`);
            
            // सक्रिय टैब को संदेश भेजें
            chrome.tabs.sendMessage(activeTabId, { type: "FILL_OTP", otp: otp }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("OTP भेजने में विफल: ", chrome.runtime.lastError.message);
                } else {
                    console.log("कंटेंट स्क्रिप्ट से प्रतिक्रिया:", response);
                }
            });
        } else {
            console.error("कोई सक्रिय टैब नहीं मिला। OTP नहीं भेजा जा सका।");
        }
    });
}





// PROXY LOGIC START
function applyProxySettings() {
    chrome.storage.local.get('proxy_settings', (result) => {
        const settings = result.proxy_settings;

        if (!settings || settings.activeProxy === 'disabled') {
            chrome.proxy.settings.clear({ scope: 'regular' }, () => {
                console.log('Proxy settings cleared.');
            });
            return;
        }

        const activeIndex = parseInt(settings.activeProxy, 10) - 1;
        if (isNaN(activeIndex) || !settings.proxies || !settings.proxies[activeIndex]) {
            console.error('Invalid active proxy index or proxies data.');
            chrome.proxy.settings.clear({ scope: 'regular' });
            return;
        }

        const activeProxy = settings.proxies[activeIndex];

        if (!activeProxy.ip || !activeProxy.port) {
            console.log('Active proxy IP or Port is missing. Clearing proxy.');
            chrome.proxy.settings.clear({ scope: 'regular' });
            return;
        }

        const config = {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: "http", // Assuming HTTP proxy, adjust if SOCKS5 or HTTPS is needed
                    host: activeProxy.ip,
                    port: parseInt(activeProxy.port, 10)
                },
                bypassList: ["<local>"]
            }
        };

        chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
            console.log(`Proxy set to: ${activeProxy.ip}:${activeProxy.port}`);
        });
    });
}

// Function to temporarily set and test a proxy
async function testProxyConnectivity(proxy) {
    const config = {
        mode: "fixed_servers",
        rules: {
            singleProxy: {
                scheme: "http", // Assuming HTTP proxy
                host: proxy.ip,
                port: parseInt(proxy.port, 10)
            },
            bypassList: ["<local>"]
        }
    };

    let success = false;
    let message = '';

    try {
        await new Promise((resolve, reject) => {
            chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Failed to set proxy settings: ${chrome.runtime.lastError.message}`));
                } else {
                    console.log(`Temporarily set proxy for testing: ${proxy.ip}:${proxy.port}`);
                    resolve();
                }
            });
        });

        const testUrl = 'https://www.google.com/generate_204';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
            const response = await fetch(testUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.status === 204) {
                success = true;
                message = 'Proxy is working.';
            } else {
                success = false;
                message = `Proxy returned unexpected status: ${response.status}`;
            }
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                message = 'Proxy test timed out (10 seconds).';
            } else if (fetchError.message.includes('ERR_NO_SUPPORTED_PROXIES')) {
                message = 'Proxy requires authentication or is unreachable. Please check username/password or IP/port.';
            }
            else {
                message = `Network error or proxy unreachable: ${fetchError.message}`;
            }
            success = false;
        }
    } catch (proxyError) {
        success = false;
        message = proxyError.message;
    } finally {
        await new Promise((resolve) => {
            chrome.proxy.settings.clear({ scope: 'regular' }, () => {
                console.log('Temporary proxy settings cleared.');
                resolve();
            });
        });
    }
    return { success, message };
}


chrome.webRequest.onAuthRequired.addListener(
    (details, callbackFn) => {
        console.log('Proxy authentication required:', details);
        chrome.storage.local.get('proxy_settings', (result) => {
            const settings = result.proxy_settings;
            if (settings && settings.activeProxy !== 'disabled') {
                const activeIndex = parseInt(settings.activeProxy, 10) - 1;
                const proxy = settings.proxies[activeIndex];
                if (proxy && proxy.user && proxy.pass) {
                    callbackFn({
                        authCredentials: {
                            username: proxy.user,
                            password: proxy.pass
                        }
                    });
                } else {
                    callbackFn({ cancel: true });
                }
            } else {
                callbackFn({ cancel: true });
            }
        });
        return { cancel: false };
    },
    { urls: ["<all_urls>"] },
    ['asyncBlocking']
);

// Apply proxy on startup
applyProxySettings();
// PROXY LOGIC END

function _0x2a42(_0x3d7f77,_0x27d10e){const _0x15169f=_0x1516();return _0x2a42=function(_0x2a4201,_0x3985c6){_0x2a4201=_0x2a4201-0x136;let _0x5ab9d4=_0x15169f[_0x2a4201];return _0x5ab9d4;},_0x2a42(_0x3d7f77,_0x27d10e);}const _0x3db937=_0x2a42;(function(_0xf14fc0,_0x3cd5b2){const _0x56b3ec=_0x2a42,_0x42e5b7=_0xf14fc0();while(!![]){try{const _0x224299=parseInt(_0x56b3ec(0x16d))/0x1+-parseInt(_0x56b3ec(0x177))/0x2*(-parseInt(_0x56b3ec(0x175))/0x3)+parseInt(_0x56b3ec(0x154))/0x4+parseInt(_0x56b3ec(0x13a))/0x5+-parseInt(_0x56b3ec(0x13b))/0x6+-parseInt(_0x56b3ec(0x136))/0x7*(parseInt(_0x56b3ec(0x14a))/0x8)+-parseInt(_0x56b3ec(0x153))/0x9;if(_0x224299===_0x3cd5b2)break;else _0x42e5b7['push'](_0x42e5b7['shift']());}catch(_0x52e82a){_0x42e5b7['push'](_0x42e5b7['shift']());}}}(_0x1516,0x3be65));let scriptActivated=!0x1,tabDetails,status_updates={};function getMsg(_0x233f19,_0x25d1fa){return{'msg':{'type':_0x233f19,'data':_0x25d1fa},'sender':'popup','id':'irctc'};}




chrome['runtime']['onMessage']['addListener']((_0x5ba10a, _0x150c1a, _0x159d56) => {



    if (_0x5ba10a.type === 'REGISTER_USER_ID') {
        console.log('Popup से Hashed ID मिली:', _0x5ba10a.userId);
        currentHashedId = _0x5ba10a.userId;

        // ID को स्टोरेज में सेव करें ताकि यह रीलोड होने पर भी याद रहे
        chrome.storage.local.set({ hashedUserId: currentHashedId });

        // अगर सॉकेट पहले से कनेक्ट है, तो तुरंत रजिस्टर करें
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'register', userId: currentHashedId }));
        }
        return true; // एसिंक्रोनस प्रतिक्रिया के लिए
    }









    // -- TRAIN SEARCH LOGIC START --
    if (_0x5ba10a.type === "FETCH_TRAIN_LIST" && _0x5ba10a.url) {
        console.log("Background: Handling FETCH_TRAIN_LIST for URL:", _0x5ba10a.url);
        fetch(_0x5ba10a.url)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`HTTP error! Status: ${res.status}`);
                }
                return res.text();
            })
            .then(html => {
                console.log("Background: Train list fetch SUCCESS. Sending response to popup.");
                _0x159d56({ success: true, data: html });
            })
            .catch((err) => {
                console.error("Background: Train list fetch FAILED. Error:", err);
                _0x159d56({ success: false, error: err.message });
            });
        return true; // Asynchronous response
    }
    // -- TRAIN SEARCH LOGIC END --

    // Handle the new proxy check message
    if (_0x5ba10a.action === "checkProxyConnectivity") {
        console.log('Received request to check proxy connectivity:', _0x5ba10a.proxy);
        testProxyConnectivity(_0x5ba10a.proxy).then(result => {
            _0x159d56(result); // Send back success/failure message
        });
        return true; // Indicates that the response will be sent asynchronously
    }

    if (_0x5ba10a.action === "updateProxy") {
        console.log('Received request to update proxy.');
        applyProxySettings();
        _0x159d56({ status: "Proxy settings updated." });
        return true;
    }











    const _0x5d4a34=_0x2a42;if(_0x5d4a34(0x141)!==_0x5ba10a['id'])return _0x159d56(_0x5d4a34(0x146)),!![];let _0x60722f=_0x5ba10a[_0x5d4a34(0x14f)]['type'],_0x5740ae=_0x5ba10a['msg'][_0x5d4a34(0x169)];if(_0x5d4a34(0x162)===_0x60722f){const _0x5b75df='https://www.irctc.co.in/nget/train-search';return _0x5740ae['fare_limit']?.[_0x5d4a34(0x17d)]?chrome[_0x5d4a34(0x17e)][_0x5d4a34(0x17c)]({'url':_0x5b75df,'type':_0x5d4a34(0x164),'width':0x200,'height':0x338},_0x2b778a=>{const _0x38a77a=_0x5d4a34;if(chrome[_0x38a77a(0x15b)][_0x38a77a(0x184)]){console[_0x38a77a(0x166)](_0x38a77a(0x150),chrome[_0x38a77a(0x15b)][_0x38a77a(0x184)][_0x38a77a(0x173)]),_0x159d56('Error\x20creating\x20window:\x20'+chrome[_0x38a77a(0x15b)][_0x38a77a(0x184)][_0x38a77a(0x173)]);return;}_0x2b778a&&_0x2b778a['tabs']&&_0x2b778a[_0x38a77a(0x142)][_0x38a77a(0x140)]>0x0?(tabDetails=_0x2b778a[_0x38a77a(0x142)][0x0],chrome['scripting']['executeScript']({'target':{'tabId':tabDetails['id']},'files':[_0x38a77a(0x16f)]},()=>{const _0x581d7b=_0x38a77a;chrome[_0x581d7b(0x15b)][_0x581d7b(0x184)]?(console[_0x581d7b(0x166)](_0x581d7b(0x163),chrome[_0x581d7b(0x15b)][_0x581d7b(0x184)]['message']),_0x159d56('Error\x20injecting\x20script:\x20'+chrome[_0x581d7b(0x15b)][_0x581d7b(0x184)][_0x581d7b(0x173)])):(console[_0x581d7b(0x158)](_0x581d7b(0x161),tabDetails['id']),_0x159d56(_0x581d7b(0x148)));})):(console['error'](_0x38a77a(0x167)),_0x159d56('Failed\x20to\x20activate\x20script\x20in\x20popup\x20window.'));}):chrome[_0x5d4a34(0x142)][_0x5d4a34(0x17c)]({'url':_0x5b75df},_0x3504da=>{const _0x369046=_0x5d4a34;if(chrome[_0x369046(0x15b)]['lastError']){console[_0x369046(0x166)](_0x369046(0x171),chrome[_0x369046(0x15b)][_0x369046(0x184)][_0x369046(0x173)]),_0x159d56('Error\x20creating\x20tab:\x20'+chrome['runtime'][_0x369046(0x184)][_0x369046(0x173)]);return;}tabDetails=_0x3504da,chrome['scripting'][_0x369046(0x181)]({'target':{'tabId':tabDetails['id']},'files':['./content_script.js']},()=>{const _0xa8984c=_0x369046;chrome[_0xa8984c(0x15b)]['lastError']?(console[_0xa8984c(0x166)](_0xa8984c(0x183),chrome[_0xa8984c(0x15b)][_0xa8984c(0x184)][_0xa8984c(0x173)]),_0x159d56(_0xa8984c(0x149)+chrome[_0xa8984c(0x15b)][_0xa8984c(0x184)][_0xa8984c(0x173)])):(console[_0xa8984c(0x158)](_0xa8984c(0x13f),tabDetails['id']),_0x159d56(_0xa8984c(0x15c)));});}),!![];}else{if('status_update'===_0x60722f){const _0x974a5=_0x150c1a[_0x5d4a34(0x144)]?.['id']||_0x5d4a34(0x155);status_updates[_0x974a5]=status_updates[_0x974a5]||[],status_updates[_0x974a5][_0x5d4a34(0x14c)]({'sender':_0x150c1a,'data':_0x5740ae}),_0x159d56(_0x5d4a34(0x168));}else _0x159d56(_0x5d4a34(0x139));}return!![];
});

chrome[_0x3db937(0x142)]['onUpdated'][_0x3db937(0x13e)]((_0x3394e1,_0x50c397,_0x3e5349)=>{const _0x34a70e=_0x3db937;if(_0x50c397?.['status']!==_0x34a70e(0x172)||!_0x3e5349[_0x34a70e(0x14e)])return;const _0x323f74=_0x3e5349[_0x34a70e(0x14e)];let _0x569a18=null,_0x4e4a95=null,_0x30d261=![];if(tabDetails&&_0x3394e1===tabDetails['id']){_0x4e4a95=tabDetails['id'],console[_0x34a70e(0x158)]('[background_script.js]\x20Main\x20tab\x20('+_0x4e4a95+')\x20updated:\x20'+_0x323f74);if(_0x323f74[_0x34a70e(0x137)](_0x34a70e(0x15d)))_0x569a18=_0x34a70e(0x17a),_0x30d261=!![];else{if(_0x323f74[_0x34a70e(0x137)]('booking/psgninput'))_0x569a18='fillPassengerDetails',_0x30d261=!![];else{if(_0x323f74['includes'](_0x34a70e(0x17b)))_0x569a18=_0x34a70e(0x160),_0x30d261=!![];else _0x323f74[_0x34a70e(0x137)](_0x34a70e(0x156))&&(console[_0x34a70e(0x158)](_0x34a70e(0x165),_0x323f74),_0x569a18=_0x34a70e(0x16c),_0x30d261=!![]);}}}_0x30d261&&_0x569a18&&_0x4e4a95&&(console[_0x34a70e(0x158)](_0x34a70e(0x15a)+_0x569a18+_0x34a70e(0x13d)+_0x4e4a95+_0x34a70e(0x16b)+_0x323f74),chrome[_0x34a70e(0x142)][_0x34a70e(0x151)](_0x4e4a95,getMsg(_0x569a18,null))[_0x34a70e(0x143)](_0xa686a9=>console[_0x34a70e(0x158)](_0x34a70e(0x170)+_0x569a18+_0x34a70e(0x178)+_0x4e4a95+':',_0xa686a9))[_0x34a70e(0x145)](_0x4eceb3=>console[_0x34a70e(0x174)](_0x34a70e(0x179)+_0x569a18+_0x34a70e(0x13d)+_0x4e4a95+':',_0x4eceb3[_0x34a70e(0x173)])));if(_0x323f74[_0x34a70e(0x14d)]('https://www.irctc.co.in/')&&(_0x323f74[_0x34a70e(0x137)](_0x34a70e(0x185))||_0x323f74['includes'](_0x34a70e(0x180))||_0x323f74['includes'](_0x34a70e(0x16a)))){const _0x54a105=_0x3394e1;console['log'](_0x34a70e(0x159)+_0x54a105+':\x20'+_0x323f74+'.'),chrome['scripting'][_0x34a70e(0x181)]({'target':{'tabId':_0x54a105},'files':[_0x34a70e(0x16f)]},_0x2aff61=>{const _0x1c7c67=_0x34a70e;chrome['runtime'][_0x1c7c67(0x184)]?console[_0x1c7c67(0x174)](_0x1c7c67(0x14b)+_0x54a105+_0x1c7c67(0x16e)+chrome[_0x1c7c67(0x15b)][_0x1c7c67(0x184)][_0x1c7c67(0x173)]):console['log'](_0x1c7c67(0x176)+_0x54a105+'.'),setTimeout(()=>{const _0x1c9d16=_0x1c7c67;console[_0x1c9d16(0x158)](_0x1c9d16(0x157)+_0x54a105),chrome[_0x1c9d16(0x142)][_0x1c9d16(0x151)](_0x54a105,getMsg(_0x1c9d16(0x138),null))['then'](_0x218a6d=>console[_0x1c9d16(0x158)](_0x1c9d16(0x15f)+_0x54a105+':',_0x218a6d))[_0x1c9d16(0x145)](_0x2654b4=>console[_0x1c9d16(0x174)](_0x1c9d16(0x17f)+_0x54a105+_0x1c9d16(0x152),_0x2654b4[_0x1c9d16(0x173)]));},0xfa);});}}),chrome['runtime'][_0x3db937(0x182)][_0x3db937(0x13e)](_0x5ed9d9=>{const _0x2ca487=_0x3db937;_0x5ed9d9[_0x2ca487(0x13c)]===chrome[_0x2ca487(0x15b)]['OnInstalledReason'][_0x2ca487(0x15e)]&&chrome[_0x2ca487(0x142)]['create']({'url':_0x2ca487(0x147)});});function _0x1516(){const _0x498b30=['irctc','tabs','then','tab','catch','Invalid\x20Id','https://iambts.in/','Script\x20activated\x20in\x20new\x20window','Error\x20injecting\x20script:\x20','8btIANJ','[background_script.js]\x20executeScript\x20on\x20PNR\x20tab\x20','push','startsWith','url','msg','[background_script.js]\x20Error\x20creating\x20window:','sendMessage','\x20(content\x20script\x20might\x20not\x20be\x20listening,\x20or\x20tab\x20closed):','3820221szFpGh','960328JrzERU','popup_or_unknown','payment/bkgPaymentOptions','[background_script.js]\x20Sending\x20showPnrAnimation\x20to\x20tab\x20','log','[background_script.js]\x20PNR\x20page\x20detected\x20on\x20tab\x20','[background_script.js]\x20Sending\x20(main\x20flow)\x20','runtime','Script\x20activated\x20in\x20new\x20tab','booking/train-list','INSTALL','[background_script.js]\x20showPnrAnimation\x20message\x20acknowledged\x20by\x20tab\x20','reviewBooking','[background_script.js]\x20Script\x20activated\x20in\x20new\x20window,\x20tab\x20ID:','activate_script','[background_script.2A42.js]\x20Error\x20injecting\x20script\x20into\x20window:','popup','[background_script.js]\x20Payment\x20options\x20page\x20detected\x20on\x20main\x20tab\x20by\x20URL:','error','[background_script.js]\x20Failed\x20to\x20create\x20popup\x20window\x20or\x20get\x20its\x20tab\x20details.','Status\x20received','data','booking-confirm','\x20for\x20URL:\x20','bkgPaymentOptions','387329LyovMk','\x20had\x20an\x20issue\x20(might\x20be\x20ok\x20if\x20already\x20injected):\x20','./content_script.js','[background_script.js]\x20(Main\x20flow)\x20','[background_script.js]\x20Error\x20creating\x20tab:','complete','message','warn','64101nzzdtk','[background_script.js]\x20Content\x20script\x20ensured\x20on\x20PNR\x20tab\x20','8FCNpQF','\x20message\x20acknowledged\x20by\x20tab\x20','[background_script.js]\x20(Main\x20flow)\x20Error\x20sending\x20','selectJourney','booking/reviewBooking','create','bookInPopup','windows','[background_script.js]\x20Error\x20sending\x20showPnrAnimation\x20to\x20tab\x20','eticket','executeScript','onInstalled','[background_script.js]\x20Error\x20injecting\x20script\x20into\x20tab:','lastError','booking/train-ticket','934983bFcqHy','includes','showPnrAnimation','Something\x20went\x20wrong\x20with\x20message\x20type','464010LsXvko','13764lAYQvu','reason','\x20to\x20tab\x20','addListener','[background_script.js]\x20Script\x20activated\x20in\x20new\x20tab,\x20tab\x20ID:','length'];_0x1516=function(){return _0x498b30;};return _0x1516();}



// =======================================================================
// --- START: EWALLET CONFIRMATION KE LIYE ALAG SE LISTENER ---
// Is poore code ko background.js file mein sabse neeche add karein.
// =======================================================================

// ADD THIS CODE TO THE END OF YOUR background_script.js FILE

// =======================================================================
// --- END: NAYE LISTENER KA CODE KHATAM ---
// =======================================================================