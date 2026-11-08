const multer = require('multer');

// Temporary file name (the file is deleted after it is sent to Cloudinary)
const storage = multer.diskStorage({
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per image
    fileFilter: (req, file, cb) =>
        file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed'))
});

module.exports = upload;