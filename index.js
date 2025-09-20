const JTPEncoder = require('./lib/Encoder');
const JTPDecoder = require('./lib/Decoder');

const { VERSION } = require('./lib/constants');

module.exports = {
    VERSION,
    JTPEncoder,
    JTPDecoder
};