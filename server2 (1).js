require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ================== 1. Database Connection ==================
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
        seedDatabase();
    })
    .catch(err => console.error('❌ DB Error:', err));

// ================== 2. Models ==================
const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    houseCode: { type: String, required: true },
    settings: {
        notifications: { type: Boolean, default: true },
        darkMode: { type: Boolean, default: false }
    }
});

// ✅ FIX: أضفنا houseCode للـ Log عشان نقدر نفلتر per house
// ✅ FIX: أضفنا eventType عشان نسجل أوامر التحكم مش بس الـ sensors
const logSchema = new mongoose.Schema({
    sensorName: { type: String, required: true },
    value: { type: Number },
    roomKey: String,
    houseCode: { type: String, required: true },  // ✅ كان ناقص
    eventType: { type: String, enum: ['sensor', 'control', 'door'], default: 'sensor' }, // ✅ جديد
    triggeredBy: { type: String, default: 'system' }, // ✅ جديد: مين عمل الأكشن
    timestamp: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    key: { type: String, required: true },
    houseCode: { type: String, required: true }
});

const deviceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, required: true },
    roomKey: { type: String, required: true },
    houseCode: { type: String, required: true },
    status: { type: Boolean, default: false },
    value: { type: Number, default: 0 },
    pinCode: { type: String, default: "1234" }  // ✅ سنعمل hash ليه في الـ seeding
});

// ✅ جديد: نموذج للـ Schedules (أتمتة)
const scheduleSchema = new mongoose.Schema({
    houseCode: { type: String, required: true },
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
    action: {
        status: Boolean,
        value: Number
    },
    cronTime: { type: String, required: true }, // e.g., "07:00"
    days: [{ type: String }],                   // e.g., ["Mon", "Tue"]
    isActive: { type: Boolean, default: true },
    label: { type: String }
});

const User = mongoose.model('User', userSchema);
const Log = mongoose.model('Log', logSchema);
const Room = mongoose.model('Room', roomSchema);
const Device = mongoose.model('Device', deviceSchema);
const Schedule = mongoose.model('Schedule', scheduleSchema);

// ================== 3. Data Seeding ==================
async function seedDatabase() {
    const defaultHouse = "HOUSE1";

    const rooms = [
        { name: 'Living Room', key: 'living', houseCode: defaultHouse },
        { name: 'Bed Room', key: 'bedroom', houseCode: defaultHouse },
        { name: 'Bath Room', key: 'bathroom', houseCode: defaultHouse },
        { name: 'Kitchen', key: 'kitchen', houseCode: defaultHouse },
        { name: 'Kids Room', key: 'kidsroom', houseCode: defaultHouse },
        { name: 'Storage', key: 'storage', houseCode: defaultHouse },
        { name: 'Hallway', key: 'hallway', houseCode: defaultHouse },
        { name: 'Garage', key: 'garage', houseCode: defaultHouse }
    ];

    // ✅ FIX: عملنا hash للـ PIN بدل ما نخزنه plain text
    const defaultPinHash = await bcrypt.hash("1234", 10);
    const apartmentPinHash = await bcrypt.hash("0000", 10);

    const devices = [
        // Living Room
        { name: 'Light1', type: 'light', roomKey: 'living', houseCode: defaultHouse },
        { name: 'Light2', type: 'light', roomKey: 'living', houseCode: defaultHouse },
        { name: 'Fan', type: 'fan', roomKey: 'living', value: 0, status: false, houseCode: defaultHouse },
        { name: 'Motion Sensor', type: 'sensor', roomKey: 'living', houseCode: defaultHouse },
        { name: 'Temperature', type: 'sensor', roomKey: 'living', houseCode: defaultHouse },
        // Bed Room
        { name: 'Light', type: 'light', roomKey: 'bedroom', houseCode: defaultHouse },
        { name: 'Fan', type: 'fan', roomKey: 'bedroom', value: 0, status: false, houseCode: defaultHouse },
        { name: 'Temperature', type: 'sensor', roomKey: 'bedroom', houseCode: defaultHouse },
        // Bath Room
        { name: 'Light', type: 'light', roomKey: 'bathroom', houseCode: defaultHouse },
        { name: 'Gas', type: 'sensor', roomKey: 'bathroom', houseCode: defaultHouse },
        // Kitchen
        { name: 'Light', type: 'light', roomKey: 'kitchen', houseCode: defaultHouse },
        { name: 'Temperature', type: 'sensor', roomKey: 'kitchen', houseCode: defaultHouse },
        { name: 'Gas Sensor', type: 'sensor', roomKey: 'kitchen', houseCode: defaultHouse },
        // Kids Room
        { name: 'Light', type: 'light', roomKey: 'kidsroom', houseCode: defaultHouse },
        { name: 'Fan', type: 'fan', roomKey: 'kidsroom', value: 0, status: false, houseCode: defaultHouse },
        // Storage
        { name: 'Light', type: 'light', roomKey: 'storage', houseCode: defaultHouse },
        { name: 'Fan', type: 'fan', roomKey: 'storage', value: 0, status: false, houseCode: defaultHouse },
        // Garage
        { name: 'Light', type: 'light', roomKey: 'garage', houseCode: defaultHouse },
        { name: 'GarageDoor', type: 'door', roomKey: 'garage', houseCode: defaultHouse, pinCode: defaultPinHash },
        // Hallway
        { name: 'Light1', type: 'light', roomKey: 'hallway', houseCode: defaultHouse },
        { name: 'Light2', type: 'light', roomKey: 'hallway', houseCode: defaultHouse },
        { name: 'ApartmentDoor', type: 'door', roomKey: 'hallway', houseCode: defaultHouse, pinCode: apartmentPinHash, status: false }
    ];

    try {
        for (let r of rooms) {
            await Room.findOneAndUpdate(
                { key: r.key, houseCode: r.houseCode },
                r,
                { upsert: true, returnDocument: 'after' }
            );
        }
        for (let d of devices) {
            await Device.findOneAndUpdate(
                { name: d.name, roomKey: d.roomKey, houseCode: d.houseCode },
                { $setOnInsert: d },  // ✅ FIX: $setOnInsert بدل overwrite عشان منمسحش الـ PIN لو اتغير
                { upsert: true, returnDocument: 'after' }
            );
        }
        console.log('🏠 Home structure is ready (Rooms & Devices seeded)');
    } catch (err) {
        console.error('Error seeding data:', err);
    }
}

// ================== 4. Middleware ==================

// ✅ FIX: Rate Limiting على Login عشان نمنع Brute Force
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 10,                   // أقصى 10 محاولات
    message: { error: 'Too many login attempts, please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ✅ جديد: Rate Limiting عام على كل الـ API
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // دقيقة واحدة
    max: 100,
    message: { error: 'Too many requests, slow down.' }
});
app.use('/api/', generalLimiter);

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access Denied: No Token Provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        if (!verified.id || !verified.houseCode) {
            return res.status(401).json({ error: 'Access Denied: Invalid Token Payload' });
        }
        req.user = verified;
        next();
    } catch (err) {
        console.error("JWT Verification Error:", err.message);
        res.status(400).json({ error: 'Invalid Token' });
    }
};

// ✅ جديد: Middleware للتحقق من Hardware API Key
const hardwareAuthMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.HARDWARE_API_KEY) {
        console.warn(`⚠️ Unauthorized hardware request from IP: ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    next();
};

// ================== 5. APIs ==================

// --- Auth ---
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, password, confirm_password, houseCode } = req.body;

        if (!fullName || !password || !email || !confirm_password || !houseCode) {
            return res.status(400).json({ error: 'Please complete all required fields' });
        }
        if (password !== confirm_password) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }
        // ✅ FIX: رسالة خطأ واضحة بدل رسالة مبهمة
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Wrong in registered' });

        const hashed = await bcrypt.hash(password, 10);
        const user = new User({ fullName, email, password: hashed, houseCode });
        await user.save();

        const token = jwt.sign(
            { id: user._id, houseCode: user.houseCode },
            process.env.JWT_SECRET,
            { expiresIn: '7d' } // ✅ FIX: التوكن بيتنتهي بعد 7 أيام مش دايم
        );

        console.log(`✅ New User registered: [${fullName}] for House: [${houseCode}]`);
        res.status(201).json({ message: 'User created successfully', token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error creating user' });
    }
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        // ✅ FIX: نفس الرسالة لو الإيميل غلط أو الباسوورد غلط (أمان أكتر)
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

        const token = jwt.sign(
            { id: user._id, houseCode: user.houseCode },
            process.env.JWT_SECRET,
            { expiresIn: '7d' } // ✅ FIX: التوكن بيتنتهي
        );

        res.json({
            token,
            user: {
                fullName: user.fullName,
                email: user.email,
                houseCode: user.houseCode
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Login error' });
    }
});

// --- Rooms & Devices ---
app.get('/api/rooms', authMiddleware, async (req, res) => {
    try {
        const rooms = await Room.find({ houseCode: req.user.houseCode });
        res.json(rooms);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

app.get('/api/rooms/:roomKey/devices', authMiddleware, async (req, res) => {
    try {
        const devices = await Device.find({
            roomKey: req.params.roomKey,
            houseCode: req.user.houseCode
        });
        res.json(devices);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch devices' });
    }
});

// ✅ FIX: تحديث الـ Fan بيحدث الـ status تلقائياً (value > 0 = ON)
app.patch('/api/devices/:id', authMiddleware, async (req, res) => {
    try {
        const { status, value } = req.body;

        const updateData = { status, value };

        // ✅ FIX: لو الجهاز fan والـ value اتبعت، نحدد الـ status تلقائياً
        if (value !== undefined) {
            updateData.status = value > 0;
        }

        const device = await Device.findOneAndUpdate(
            { _id: req.params.id, houseCode: req.user.houseCode },
            updateData,
            { new: true }
        );

        if (!device) return res.status(404).json({ error: 'Device not found' });

        // ✅ FIX: سجّل أوامر التحكم في الـ Log (مش بس الـ sensors)
        await Log.create({
            sensorName: device.name,
            value: device.value,
            roomKey: device.roomKey,
            houseCode: req.user.houseCode,
            eventType: 'control',
            triggeredBy: req.user.id
        });

        const time = new Date().toLocaleTimeString();
        if (device.type === 'fan') {
            console.log(`[${time}] 🌀 Fan Speed: [${device.name}] set to (${device.value}) → Status: ${device.status ? 'ON' : 'OFF'} in [${device.roomKey}]`);
        } else {
            const state = device.status ? 'ON ✅' : 'OFF ❌';
            console.log(`[${time}] 💡 Device Change: [${device.name}] in [${device.roomKey}] is now ${state}`);
        }

        io.to(req.user.houseCode).emit('device_updated', device);
        res.json(device);
    } catch (err) {
        console.error('❌ Patch Error:', err);
        res.status(500).json({ error: 'Error updating device' });
    }
});

// ✅ FIX: أضفنا hardwareAuthMiddleware عشان الـ ESP32 فقط يقدر يبعت بيانات
app.post('/api/sensor/update', hardwareAuthMiddleware, async (req, res) => {
    try {
        const { roomKey, sensorName, value, houseCode } = req.body;

        if (!roomKey || !sensorName || value === undefined || !houseCode) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const device = await Device.findOneAndUpdate(
            { roomKey, name: sensorName, houseCode },
            { value },
            { returnDocument: 'after' }
        );

        if (!device) {
            return res.status(404).json({ error: 'Sensor not found' });
        }

        // ✅ FIX: السجل بيشمل houseCode دلوقتي
        await Log.create({ sensorName, value, roomKey, houseCode, eventType: 'sensor' });

        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] 📡 Sensor Data: [${sensorName}] in [${roomKey}] sent value: (${value})`);

        // ✅ جديد: تحقق من قيم الغاز وابعت Alert لو فوق الحد
        if ((sensorName.toLowerCase().includes('gas')) && value > 400) {
            console.warn(`🚨 GAS ALERT in [${roomKey}]! Value: ${value}`);
            io.to(houseCode).emit('danger_alert', {
                type: 'GAS',
                roomKey,
                value,
                message: `⚠️ Gas leak detected in ${roomKey}! Value: ${value}`
            });
        }

        // ✅ جديد: تحقق من درجة حرارة عالية
        if (sensorName.toLowerCase().includes('temperature') && value > 45) {
            console.warn(`🌡️ HIGH TEMP ALERT in [${roomKey}]! Value: ${value}`);
            io.to(houseCode).emit('danger_alert', {
                type: 'TEMPERATURE',
                roomKey,
                value,
                message: `⚠️ High temperature in ${roomKey}! Temp: ${value}°C`
            });
        }

        io.to(houseCode).emit('update_ui', { roomKey, sensorName, value });
        res.json({ success: true, message: 'Sensor updated' });
    } catch (err) {
        console.error('❌ Sensor Update Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Family ---
app.get('/api/family', authMiddleware, async (req, res) => {
    try {
        const familyMembers = await User.find({ houseCode: req.user.houseCode })
            .select('fullName email');
        res.json({ count: familyMembers.length, members: familyMembers });
    } catch (err) {
        console.error('❌ Family Fetch Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ✅ تغيير الاسم والباسورد
app.patch('/api/profile', authMiddleware, async (req, res) => {
    try {
        const { fullName, currentPassword, newPassword } = req.body;

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const updateData = {};

        // ✅ تغيير الاسم لو اتبعت
        if (fullName && fullName.trim()) {
            updateData.fullName = fullName.trim();
        }

        // ✅ تغيير الباسورد لو اتبعت
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({ error: 'Current password is required to set a new password' });
            }
            if (newPassword.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters' });
            }

            const valid = await bcrypt.compare(currentPassword, user.password);
            if (!valid) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            updateData.password = await bcrypt.hash(newPassword, 10);
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No data provided to update' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            updateData,
            { new: true }
        ).select('fullName email houseCode');

        console.log(`✅ Profile updated for user [${req.user.id}]`);
        res.json({ success: true, user: updatedUser });

    } catch (err) {
        console.error('❌ Profile Update Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- Door Unlock ---
// ✅ FIX: الـ PIN بقى يتحقق منه عن طريق bcrypt.compare بدل المقارنة المباشرة
app.post('/api/devices/unlock-door', authMiddleware, async (req, res) => {
    try {
        const { deviceId, pin } = req.body;

        if (!deviceId || !pin) {
            return res.status(400).json({ error: 'deviceId and pin are required' });
        }

        const device = await Device.findOne({ _id: deviceId, houseCode: req.user.houseCode });

        if (!device || device.type !== 'door') {
            return res.status(404).json({ error: 'Door not found' });
        }

        // ✅ FIX: bcrypt.compare بدل المقارنة المباشرة
        const pinMatch = await bcrypt.compare(pin, device.pinCode);

        if (pinMatch) {
            device.status = true;
            await device.save();

            // ✅ FIX: سجّل حدث فتح الباب في الـ Log
            await Log.create({
                sensorName: device.name,
                value: 1,
                roomKey: device.roomKey,
                houseCode: req.user.houseCode,
                eventType: 'door',
                triggeredBy: req.user.id
            });

            io.to(req.user.houseCode).emit('device_updated', device);
            console.log(`✅ Door [${device.name}] Unlocked by user [${req.user.id}]`);

            // ✅ جديد: قفّل الباب تلقائياً بعد 5 ثواني
            setTimeout(async () => {
                device.status = false;
                await device.save();
                io.to(req.user.houseCode).emit('device_updated', device);
                console.log(`🔒 Door [${device.name}] Auto-Locked after 5 seconds`);
            }, 5000);

            return res.json({ success: true, message: 'Door Unlocked' });
        } else {
            // ✅ FIX: سجّل محاولة الفتح الفاشلة
            await Log.create({
                sensorName: device.name,
                value: 0,
                roomKey: device.roomKey,
                houseCode: req.user.houseCode,
                eventType: 'door',
                triggeredBy: req.user.id
            });

            console.warn(`❌ Failed unlock attempt for door [${device.name}] by user [${req.user.id}]`);
            return res.status(401).json({ success: false, message: 'Wrong PIN Code' });
        }
    } catch (err) {
        console.error('❌ Door Unlock Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ✅ جديد: تغيير PIN الباب
app.patch('/api/devices/:id/change-pin', authMiddleware, async (req, res) => {
    try {
        const { oldPin, newPin } = req.body;

        if (!oldPin || !newPin) {
            return res.status(400).json({ error: 'oldPin and newPin are required' });
        }
        if (newPin.length < 4) {
            return res.status(400).json({ error: 'PIN must be at least 4 digits' });
        }

        const device = await Device.findOne({ _id: req.params.id, houseCode: req.user.houseCode });
        if (!device || device.type !== 'door') {
            return res.status(404).json({ error: 'Door not found' });
        }

        const pinMatch = await bcrypt.compare(oldPin, device.pinCode);
        if (!pinMatch) {
            return res.status(401).json({ error: 'Old PIN is incorrect' });
        }

        device.pinCode = await bcrypt.hash(newPin, 10);
        await device.save();

        console.log(`🔑 PIN changed for door [${device.name}] by user [${req.user.id}]`);
        res.json({ success: true, message: 'PIN updated successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});



// ✅ جديد: Schedules (أتمتة)
app.get('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const schedules = await Schedule.find({ houseCode: req.user.houseCode }).populate('deviceId', 'name roomKey type');
        res.json(schedules);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch schedules' });
    }
});

app.post('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { deviceId, action, cronTime, days, label } = req.body;

        if (!deviceId || !action || !cronTime) {
            return res.status(400).json({ error: 'deviceId, action, and cronTime are required' });
        }

        const device = await Device.findOne({ _id: deviceId, houseCode: req.user.houseCode });
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const schedule = await Schedule.create({
            houseCode: req.user.houseCode,
            deviceId,
            action,
            cronTime,
            days: days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            label
        });

        console.log(`⏰ Schedule created: [${label}] for device [${device.name}] at ${cronTime}`);
        res.status(201).json(schedule);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});

app.delete('/api/schedules/:id', authMiddleware, async (req, res) => {
    try {
        const schedule = await Schedule.findOneAndDelete({ _id: req.params.id, houseCode: req.user.houseCode });
        if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
        res.json({ success: true, message: 'Schedule deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

// ✅ جديد: Logs & History
app.get('/api/logs', authMiddleware, async (req, res) => {
    try {
        const { roomKey, eventType, limit = 50 } = req.query;
        const filter = { houseCode: req.user.houseCode };
        if (roomKey) filter.roomKey = roomKey;
        if (eventType) filter.eventType = eventType;

        const logs = await Log.find(filter)
            .sort({ timestamp: -1 })
            .limit(parseInt(limit));

        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// ================== 6. Socket & Server ==================
io.on('connection', (socket) => {
    const houseCode = socket.handshake.query.houseCode;

    if (houseCode) {
        socket.join(houseCode);
        console.log(`🔌 Connected to House Room: ${houseCode}`);
    }

    socket.on('control_device', (data) => {
        io.to(data.houseCode).emit('hardware_command', data);
        console.log(`📡 Command sent to House [${data.houseCode}]:`, data);
    });

    socket.on('disconnect', () => {
        console.log('❌ Socket disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
