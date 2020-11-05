'use strict';

// NodeJS Packages
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const crypto = require('crypto');
const fetch = require('node-fetch');
let botmetrics = require('botmetrics');
const app = express();

let firstName = "undefined";
let lastName = "undefined";
let senderContext = {};
let isStopped = false;
let TYPING_INDICATOR = true;

// Messenger API parameters
const token = process.env.FB_PAGE_ACCESS_TOKEN;
if (!token) {
    throw new Error('missing FB_PAGE_ACCESS_TOKEN')
}

// Wit.ai parameters
const witToken = process.env.WIT_TOKEN;
if (!witToken) {
    throw new Error('missing WIT_TOKEN')
}

const sessions = {};
let Wit = null;
let log = null;
try {
    // if running from repo
    Wit = require('../').Wit;
    log = require('../').log;
} catch (e) {
    Wit = require('node-wit').Wit;
    log = require('node-wit').log;
}

// Bot actions
const actions = {
    send({
        sessionId
    }, {
        text
    }) {
        const recipientId = sessions[sessionId].facebookId;
        if (recipientId) {
            return sendTextMessage(recipientId, text)
                .then(() => null)
                .catch((err) => {
                    console.error(
                        'Oops! An error occurred while forwarding the response to',
                        recipientId,
                        ':',
                        err.stack || err
                    );
                });
        } else {
            console.error('Sorry! Couldn\'t find user for session:', sessionId);
            return Promise.resolve()
        }
    }
};

const findOrCreateSession = (facebookId) => {
    let sessionId;
    // Let's see if we already have a session for the user facebookId
    Object.keys(sessions).forEach(k => {
        if (sessions[k].facebookId === facebookId) {
            // Yes, got it!
            sessionId = k;
        }
    });
    if (!sessionId) {
        // No session found for user facebookId, let's create a new one
        sessionId = new Date().toISOString();
        sessions[sessionId] = {
            facebookId: facebookId,
            context: {}
        };
    }
    return sessionId;
};

// Setting up our bot
const wit = new Wit({
    accessToken: witToken,
    actions,
    logger: new log.Logger(log.INFO)
});

app.set('port', (process.env.PORT || 5000));

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}));

// Parse application/json
app.use(bodyParser.json());

// Index
app.get('/', function(req, res) {
    res.send('Hello world ! This is the Husets Forsikring chatbot messenger');
});

// For facebook verification
app.get('/webhook/', function(req, res) {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    }
    res.send('Error, wrong token !');
});

// To post data
app.post('/webhook/', function(req, res) {

    // Configuration botmetrics platform
    botmetrics.track(req.body, {
        apiKey: process.env.BOTMETRICS_API_KEY,
        botId: process.env.BOTMETRICS_BOT_ID
    });

    // Parse the Messenger payload
    let data = req.body;

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function(pageEntry) {
            // Iterate over each messaging event
            pageEntry.messaging.forEach(function(messagingEvent) {
                if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });
        res.sendStatus(200);
    }

    let messaging_events = req.body.entry[0].messaging;

    for (let i = 0; i < messaging_events.length; i++) {
        let event = req.body.entry[0].messaging[i];
        let sender = event.sender.id;

        if (event.message && !event.message.is_echo && !event.message.quick_reply && event.message.text != 'add_menu_husets_forsikring' && event.message.text != 'remove_menu_husets_forsikring' && event.message.text != 'activate_typing_indicator' && event.message.text != 'deactivate_typing_indicator') {
            const sender = event.sender.id;
            const sessionId = findOrCreateSession(sender);
            const {
                text,
                attachments
            } = event.message;

            let inputText = event.message.text;
            let isMenu = true;

            // When the user input text that match to any menu, we display the menu corresponding
            switch (inputText.toLowerCase()) {
                case 'oversigt':
                    // Overview option
                    sendJsonMessage(sender, "ressources/overview.json");
                    break;
                case 'hvem står bag':
                    // About option
                    sendJsonMessage(sender, "ressources/about.json");
                    break;
                case 'kontakt':
                    // Contact option
                    sendJsonMessage(sender, "ressources/contact.json");
                    break;
                case 'betingelser':
                    // Terms & Conditions option
                    sendJsonMessage(sender, "ressources/termsConditions.json");
                    break;
                default:
                    isMenu = false;
                    break;
            }

            if (attachments && !isMenu) {
                sendTextMessage(sender, 'Undskyld, Jeg kan kun behandle tekstbeskeder til nu.')
                    .catch(console.error);
            } else if (text && !isMenu) {
                wit.runActions(
                        sessionId,
                        text,
                        sessions[sessionId].context
                    ).then((context) => {
                        console.log('Waiting for next user messages');
                        sendTextMessage(sender, 'Tilgivelse, Jeg forstod ikke dit budskab\nDu kan omformulere š\'ils venligst !')
                            .catch(console.error);
                        // Updating the user's current session state
                        sessions[sessionId].context = context;
                    })
                    .catch((err) => {
                        console.error('Sorry! Got an error from Wit: ', err.stack || err);
                    })
            }

            // let text = event.message.text;
            // // Welcome message
            // if (text.toLowerCase() === 'hello' || text.toLowerCase() === 'hi' || text.toLowerCase() === 'hey') {
            //     // Send the welcome message
            //     sendWelcomeMessage(sender);
            // } else if (text.toLowerCase().indexOf('dækket') !== -1) {
            //     // View coverage table option
            //     sendJsonMessage(sender, "ressources/coverageTable.json");
            // } else if (text.toLowerCase().indexOf('om os') !== -1) {
            //     // About option
            //     sendJsonMessage(sender, "ressources/about.json");
            // } else if (text.toLowerCase().indexOf('betingelser') !== -1) {
            //     // View terms and conditions
            //     sendJsonMessage(sender, "ressources/termsConditions.json");
            // }

        } else if (event.postback) {
            let text = JSON.stringify(event.postback);
            let postbackMessage = JSON.parse(text);
            // Get started button
            switch (postbackMessage.payload) {
                case 'GET_STARTED_PAYLOAD':
                    // Send the get started message
                    sendGetStartedMessage(sender);
                    break;
                case 'GET_STARTED_PAYLOAD_OK':
                    // Send the welcome message
                    sendWelcomeMessage(sender);
                    break;
                case 'OVERVIEW_PAYLOAD':
                    // Overview option
                    sendJsonMessage(sender, "ressources/overview.json");
                    break;
                case 'ABOUT_PAYLOAD':
                    // About option
                    sendJsonMessage(sender, "ressources/about.json");
                    break;
                case 'CONTACT_PAYLOAD':
                    // Contact option
                    sendJsonMessage(sender, "ressources/contact.json");
                    break;
                case 'T_C_PAYLOAD':
                    // Terms & Conditions option
                    sendJsonMessage(sender, "ressources/termsConditions.json");
                    break;
                case 'TELL_ME_MORE_1_PAYLOAD':
                    // Tell me more (info 1) option
                    sendJsonMessage(sender, "ressources/telMeMore1.json");
                    break;
                case 'VIEW_COVERAGE_TABLE_PAYLOAD':
                    // View coverage table option
                    sendJsonMessage(sender, "ressources/coverageTable.json");
                    break;
                case 'VIEW_ALL_PRODUCT_2_PAYLOAD':
                    // View all product 2 years option
                    sendJsonMessage(sender, "ressources/listProduct2.json");
                    break;
                case 'VIEW_ALL_PRODUCT_3_PAYLOAD':
                    // View all product 3 years option
                    sendJsonMessage(sender, "ressources/listProduct3.json");
                    break;
                case 'VIEW_ALL_PRODUCT_4_PAYLOAD':
                    // View all product 4 years option
                    sendJsonMessage(sender, "ressources/listProduct4.json");
                    break;
                case 'VIEW_ALL_PRODUCT_5_PAYLOAD':
                    // View all product 5 years option
                    sendJsonMessage(sender, "ressources/listProduct5.json");
                    break;
                case 'READ_FINE_PRINT_PAYLOAD':
                    // View read fine pr int option
                    sendJsonMessage(sender, "ressources/finePrint.json");
                    break;
                default:
                    break;
            }
        } else if (event.message.quick_reply) {
            switch (event.message.quick_reply.payload) {
                case 'VIEW_COVERAGE_TABLE_PAYLOAD':
                    // View coverage table option
                    sendJsonMessage(sender, "ressources/coverageTable.json");
                    break;
                case 'TELL_ME_MORE_1_PAYLOAD':
                    // Tell me more (info 1) option
                    sendJsonMessage(sender, "ressources/telMeMore1.json");
                    break;
                case 'TELL_ME_MORE_2_PAYLOAD':
                    // Overview option
                    sendJsonMessage(sender, "ressources/telMeMore2.json");
                    break;
                case 'TELL_ME_MORE_3_PAYLOAD':
                    // Tell me more (info 3) option
                    sendJsonMessage(sender, "ressources/telMeMore3.json");
                    break;
                case 'TELL_ME_MORE_4_PAYLOAD':
                    // Tell me more (info 4) option
                    sendJsonMessage(sender, "ressources/telMeMore4.json");
                    break;
                case 'TELL_ME_MORE_5_PAYLOAD':
                    // Tell me more (info 5) option
                    sendJsonMessage(sender, "ressources/telMeMore5.json");
                    break;
                case 'TELL_ME_MORE_6_PAYLOAD':
                    // Tell me more (info 6) option
                    sendJsonMessage(sender, "ressources/telMeMore6.json");
                    break;
                case 'URL_BUY_PAYLOAD':
                    // View coverage table option
                    sendJsonMessage(sender, "ressources/buyURL.json");
                    break;
                case 'VIEW_ALL_PRODUCT_3_PAYLOAD':
                    // View all product 3 years option
                    sendJsonMessage(sender, "ressources/listProduct3.json");
                    break;
                case 'VIEW_ALL_PRODUCT_4_PAYLOAD':
                    // View all product 4 years option
                    sendJsonMessage(sender, "ressources/listProduct4.json");
                    break;
                case 'VIEW_ALL_PRODUCT_5_PAYLOAD':
                    // View all product 5 years option
                    sendJsonMessage(sender, "ressources/listProduct5.json");
                    break;
                case 'READ_FINE_PRINT_PAYLOAD':
                    // View read fine pr int option
                    sendJsonMessage(sender, "ressources/finePrint.json");
                    break;
                case 'WAITING_PERIOD_PAYLOAD':
                    // View show example option
                    sendJsonMessage(sender, "ressources/waitingPeriod.json");
                    break;
                case 'ABOUT_PAYLOAD':
                    // About option
                    sendJsonMessage(sender, "ressources/about.json");
                    break;
                case 'T_C_PAYLOAD':
                    // Terms & Conditions option
                    sendJsonMessage(sender, "ressources/termsConditions.json");
                    break;
                default:
                    break;
            }
        }
    }
    res.sendStatus(200);
});

function receivedMessage(event) {
    callGetLocaleAPI(event, handleReceivedMessage);
}

function callGetLocaleAPI(event, handleReceived) {
    let userID = event.sender.id;
    let http = require('https');
    let path = '/v2.6/' + userID + '?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=' + token;
    let options = {
        host: 'graph.facebook.com',
        path: path
    };

    if (senderContext[userID]) {
        firstName = senderContext[userID].firstName;
        lastName = senderContext[userID].lastName;
        console.log("found " + JSON.stringify(senderContext[userID]));
        if (!firstName)
            firstName = "undefined";
        if (!lastName)
            lastName = "undefined";
        handleReceived(event);
        return;
    }

    let req = http.get(options, function(res) {
        // Buffer the body entirely for processing as a whole.
        let bodyChunks = [];
        res.on('data', function(chunk) {
            // You can process streamed parts here...
            bodyChunks.push(chunk);
        }).on('end', function() {
            let body = Buffer.concat(bodyChunks);
            let bodyObject = JSON.parse(body);
            firstName = bodyObject.first_name;
            lastName = bodyObject.last_name;
            if (!firstName)
                firstName = "undefined";
            if (!lastName)
                lastName = "undefined";
            senderContext[userID] = {};
            senderContext[userID].firstName = firstName;
            senderContext[userID].lastName = lastName;
            console.log("defined " + JSON.stringify(senderContext));
            handleReceived(event);
        })
    });
    req.on('error', function(e) {
        console.log('ERROR: ' + e.message);
    });
}

function addGetStartedButton() {
    request({
        url: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: {
            access_token: token
        },
        method: 'POST',
        json: {
            "setting_type": "call_to_actions",
            "thread_state": "new_thread",
            "call_to_actions": [{
                "payload": "GET_STARTED_PAYLOAD"
            }]
        }
    }, function(error, response) {
        console.log(response);
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    })
}

function removeGetStartedButton() {
    request({
        url: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: {
            access_token: token
        },
        method: 'DELETE',
        json: {
            "setting_type": "call_to_actions",
            "thread_state": "new_thread"
        }
    }, function(error, response) {
        console.log(response);
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    })
}

function addGreetingMessage() {
    request({
        url: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: {
            access_token: token
        },
        method: 'POST',
        json: {
            "setting_type": "greeting",
            "greeting": {
                "text": "Hej {{user_first_name}}. Nu kan du få én forsikring, der dækker dine hvidevarer og din elektronik til en fast, lav pris. Lær mere ved at trykke på knappen nedenfor."
            }
        }
    }, function(error, response) {
        console.log(response);
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    })
}

function removeGreetingMessage() {
    request({
        url: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: {
            access_token: token
        },
        method: 'DELETE',
        json: {
            "setting_type": "greeting"
        }
    }, function(error, response) {
        console.log(response);
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    })
}

function sendTextMessage(sender, text) {
    let messageData = {
        text: text
    };

    if (TYPING_INDICATOR) {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_on"
            }
        }, function (error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        });

        setTimeout(function () {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: token
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
                    message: messageData
                }
            }, function (error, response) {
                if (error) {
                    console.log('Error sending messages: ', error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                }
            })
        }, 3000);

        setTimeout(function () {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: token
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
                    "sender_action": "typing_off"
                }
            }, function (error, response) {
                if (error) {
                    console.log('Error sending messages: ', error)
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                }
            })
        }, 4000);
    }
    else {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                message: messageData
            }
        }, function (error, response) {
            if (error) {
                console.log('Error sending messages: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }
}

function sendGetStartedMessage(sender) {
    let senderInfo;
    request({
        url: 'https://graph.facebook.com/v2.6/' + sender + '?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=' + token,
        qs: {
            access_token: token
        },
        method: 'GET'
    }, function(error, response) {
        if (error) {
            console.log('Error sending messages: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        } else {
            senderInfo = JSON.parse(response.body);
        }
    });

    setTimeout(function() {
        let messageData = {
            text: "Hej " + senderInfo.first_name + "! Jeg er Husets chatbot. Du kan tale med mig via knapperne eller ved at skrive et spørgsmål."
        };
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                message: messageData
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        });
    }, 500);

    setTimeout(function() {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_on"
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 1000);

    setTimeout(function() {
        let messageData = {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Jeg er ny og derfor ikke så klog endnu. Så det er nok ikke alt, jeg forstår, men jo mere du skriver, jo klogere bliver jeg.",
                    buttons: [{
                        type: "postback",
                        title: "OK",
                        payload: "GET_STARTED_PAYLOAD_OK"
                    }]
                }
            }
        };
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                message: messageData
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 3000);

    setTimeout(function() {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_off"
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 4000);
}

function sendWelcomeMessage(sender) {
    let messageData = {
        text: "Husets Elektronikforsikring er en helt ny slags forsikring, der dækker alle dine hvidevarer og al dine elektronik for en fast månedlig pris."
    };
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {
            access_token: token
        },
        method: 'POST',
        json: {
            recipient: {
                id: sender
            },
            message: messageData
        }
    }, function(error, response) {
        if (error) {
            console.log('Error sending messages: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    });

    setTimeout(function() {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_on"
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 1000);

    setTimeout(function() {
        let messageData = {
            text: "Den koster 99 kr./md., uanset hvor mange produkter du har under dækning. Den dækker hvad den kan i husstanden (dvs. på din adresse). Og så er der ingen selvrisiko og ingen afskrivning."
        };
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                message: messageData
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 3000);

    setTimeout(function() {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_on"
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 4000);

    setTimeout(function() {
        let fs = require("fs");
        let jsonContent = fs.readFileSync("ressources/overview.json");
        let messageData = JSON.parse(jsonContent);
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                message: messageData
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 6000);

    setTimeout(function() {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_off"
            }
        }, function(error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }, 7000);
}

function sendJsonMessage(sender, jsonFile) {

    let fs = require("fs");
    let jsonContent = fs.readFileSync(jsonFile);
    let messageData = JSON.parse(jsonContent);

    if (TYPING_INDICATOR) {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                "sender_action": "typing_on"
            }
        }, function (error, response) {
            if (error) {
                console.log('Error sending messages: ', error)
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        });

        setTimeout(function () {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: token
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
                    message: messageData
                }
            }, function (error, response) {
                if (error) {
                    console.log('Error sending messages: ', error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                }
            })
        }, 3000);

        setTimeout(function () {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: token
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
                    "sender_action": "typing_off"
                }
            }, function (error, response) {
                if (error) {
                    console.log('Error sending messages: ', error)
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                }
            })
        }, 4000);
    }
    else {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token: token
            },
            method: 'POST',
            json: {
                recipient: {
                    id: sender
                },
                message: messageData
            }
        }, function (error, response) {
            if (error) {
                console.log('Error sending messages: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
        })
    }
}

function addPersistentMenu() {
    request({
        url: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: {
            access_token: token
        },
        method: 'POST',
        json: {
            setting_type: "call_to_actions",
            thread_state: "existing_thread",
            call_to_actions: [{
                type: "web_url",
                title: "Jeg vil gerne købe!",
                url: "http://husetsforsikring.dk/commerce/kurv?utm_source=facebook&utm_campaign=bot_answer&utm_medium=bot"
            }, {
                type: "postback",
                title: "Oversigt",
                payload: "OVERVIEW_PAYLOAD"
            }, {
                type: "postback",
                title: "Hvèem står bag",
                payload: "ABOUT_PAYLOAD"
            }, {
                type: "postback",
                title: "Kontakt",
                payload: "CONTACT_PAYLOAD"
            }, {
                type: "postback",
                title: "Betingelser",
                payload: "T_C_PAYLOAD"
            }]
        }
    }, function(error, response) {
        console.log(response);
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    })
}

function removePersistentMenu() {
    request({
        url: 'https://graph.facebook.com/v2.6/me/thread_settings',
        qs: {
            access_token: token
        },
        method: 'POST',
        json: {
            setting_type: "call_to_actions",
            thread_state: "existing_thread",
            call_to_actions: []
        }
    }, function(error, response) {
        console.log(response);
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }
    })
}

function handleReceivedMessage(event) {
    let message = event.message;
    let messageText = message.text;

    if (messageText) {
        if ((isStopped == true) && (messageText !== "start")) {
            return;
        }
        switch (messageText.toLowerCase()) {
            case 'add_menu_husets_forsikring':
                // Add the persistent menu
                addPersistentMenu();
                // Add the get started button
                addGetStartedButton();
                // Add the greeting message
                addGreetingMessage(event.sender.id);
                break;
            case 'remove_menu_husets_forsikring':
                // Remove the persistent menu
                removePersistentMenu();
                // Remove the get started button
                removeGetStartedButton();
                // Remove the greeting message
                removeGreetingMessage();
                break;
            case 'activate_typing_indicator':
                TYPING_INDICATOR = true;
                break;
            case 'deactivate_typing_indicator':
                TYPING_INDICATOR = false;
                break;
            default:
                break;
        }
    }
}

// spin spin sugar
app.listen(app.get('port'), function() {
    console.log('Running on port : ', app.get('port'));
});