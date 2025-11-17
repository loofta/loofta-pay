const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');
const db = require('./firestore');

dotenv.config();

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

exports.telegramBot = async (req, res) => {
    const message = req.body.message;

    if (!message) {
        res.status(400).send('No message in the request');
        return;
    }

    const chatId = message.chat.id;
    const text = message.text || '';
    const username = message.chat.username || 'lisatest';

    try {
        const userRef = db.collection('telegramUsers').doc(chatId.toString());
        await userRef.set({
            username,
            chatId,
        }, { merge: true });
        console.log(`User ${username} with chatId ${chatId} saved/updated in Firestore.`);
    } catch (error) {
        console.error('Error saving user to Firestore:', error);
    }

    if (text.startsWith('/start')) {
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        let options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "Launch Loofta",
                            web_app: { url: webAppUrl }
                        }
                    ],
                    [
                        {
                            text: "Channel",
                            url: "https://t.me/loofta"
                        },
                        {
                            text: "X Profile",
                            url: "https://x.com/looftaxyz"
                        }
                    ]
                ]
            }
        };

        bot.sendMessage(
            chatId, 
            "Welcome to Loofta!\n\nCreators, connect with amazing projects on TON and bring your ideas to life! Complete deals, build your reputation and earn money 🚀", 
            options
        );
    }

    res.status(200).send('Message processed');
};

exports.notifyUserForPayment = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;
    const amount = req.query.amount;

    if (!senderTgId || !dealId || !amount) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `🚀 You have a new payment request for Deal ID: ${dealId}. Amount: ${amount} USDT. Please settle the payment.`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyUserForPayment:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.notifyDealCreated = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `🎉 Your deal has been successfully created!`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            },
                            {
                                text: "Share Deal",
                                switch_inline_query: `Check out this deal: ${webAppUrl}/deal/${dealId}`
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealCreated:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};



exports.notifyCampaignCreated = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const campaignId = req.query.campaignId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = ` Your campaign has been successfully created!`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Campaign",
                                web_app: { url: `${webAppUrl}/campaigns/${campaignId}` }
                            },
                            {
                                text: "Share Campaign",
                                switch_inline_query: `Check out this deal: ${webAppUrl}/campaigns/${campaignId}`
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealCreated:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.notifyDealReceived = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `🎉 Congrats! You've received a new deal request! Review it and accept or decline it.`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealCreated:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};


exports.notifyDealAccepted = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `✅ Your deal has been accepted, Loofta\'s creator is working on it!`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            },
                            {
                                text: "Share Deal",
                                switch_inline_query: `Check out this deal: ${webAppUrl}/deal/${dealId}`
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealAccepted:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.notifyDealDeclined = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `❌ Your deal has been declined, reach out to Loofta\'s creator to know more!`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealDeclined:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.notifyDealDelivered = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `🎉 Congrats, Loofta\'s creator has completed the deal ID: ${dealId}. It\'s time to review its work :)`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            },
                            {
                                text: "Share Deal",
                                switch_inline_query: `Check out this deal: ${webAppUrl}/deal/${dealId}`
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealDeclined:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.notifyPaymentReceived = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const senderTgId = req.query.senderTgId;
    const dealId = req.query.dealId;

    if (!senderTgId || !dealId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;
        let webAppUrl = process.env.BOT_WEBAPP_URL;
        if (chatId) {
            const messageText = `🎉 Congrats, You've received a reward on Loofta! Whether it's points or USDT, keep up the great work, and more opportunities will be headed your way. 😊`;

            await bot.sendMessage(chatId, messageText, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "View Deal",
                                web_app: { url: `${webAppUrl}/deal/${dealId}` }
                            }
                        ]
                    ]
                }
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in notifyDealDeclined:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.sendNotificationMessage = async (req, res) => {
    // Set CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    try {
        const senderTgId = req.query.senderTgId;
        let message = req.query.message;

        // Convert HTML line breaks to newlines
        message = message
            .replace(/%3Cbr%3E/gi, '\n')  // URL encoded <br>
            .replace(/<br>/gi, '\n')      // Regular <br>
            .replace(/<br\/>/gi, '\n')    // Self-closing <br/>
            .replace(/<br \/>/gi, '\n');  // Self-closing with space <br />

        // Remove excessive newlines (more than 2 consecutive)
        message = message.replace(/\n{3,}/g, '\n\n');

        // Decode URL encoded text
        message = decodeURIComponent(message);

        if (!senderTgId || !message) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        console.log(`Querying document: telegramUsers/${senderTgId.toString()}`);
        const userRef = db.collection('telegramUsers').doc(senderTgId.toString());
        const doc = await userRef.get();

        if (!doc.exists) {
            console.error('No such document!');
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data();
        const chatId = userData.chatId;

        if (chatId) {
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

            return res.status(200).json({ success: 'Notification sent' });
        } else {
            console.error(`Chat ID not found for userId: ${senderTgId}`);
            return res.status(404).json({ error: 'Chat ID not found' });
        }
    } catch (error) {
        console.error('Error in sendNotificationMessage:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};