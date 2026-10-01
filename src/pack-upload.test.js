const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPackCategory,
  hasStickerDimensions,
  imageMatchesType,
  normalizeAssetName,
  parsePackArchive
} = require('./pack-upload');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipWithFile(fileName, data) {
  const name = Buffer.from(fileName);
  const checksum = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);

  const centralDirectory = Buffer.concat([centralHeader, name]);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localHeader.length + name.length + data.length, 16);
  return Buffer.concat([localHeader, name, data, centralDirectory, endRecord]);
}

function png320() {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(320, 20);
  return png;
}

test('detects emoji and sticker folders case-insensitively', () => {
  assert.equal(getPackCategory('emojis/happy.png'), 'emoji');
  assert.equal(getPackCategory('Stickers/hello.png'), 'sticker');
  assert.equal(getPackCategory('other/happy.png'), null);
});

test('normalizes pack filenames to valid expression names', () => {
  assert.equal(normalizeAssetName('Olá Mundo!!.png'), 'ola_mundo');
  assert.equal(normalizeAssetName('😃.gif'), null);
  assert.equal(normalizeAssetName('valid-name-that-is-longer-than-thirty-two-characters.webp').length, 32);
});

test('validates image signatures according to emoji and sticker types', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  assert.equal(imageMatchesType(png, '.png', 'emoji'), true);
  assert.equal(imageMatchesType(png, '.png', 'sticker'), true);
  assert.equal(imageMatchesType(Buffer.from('GIF89a'), '.gif', 'emoji'), true);
  assert.equal(imageMatchesType(Buffer.from('not an image'), '.png', 'emoji'), false);
});

test('requires stickers to have 320 by 320 pixel dimensions', () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(320, 20);
  assert.equal(hasStickerDimensions(png), true);
  png.writeUInt32BE(512, 16);
  assert.equal(hasStickerDimensions(png), false);
});

test('rejects a non-ZIP attachment', async () => {
  await assert.rejects(
    parsePackArchive(Buffer.from('not a zip archive')),
    /zip|end of central directory/i
  );
});

test('reads a valid image from its pack folder', async () => {
  const assets = await parsePackArchive(zipWithFile('emojis/party!.png', png320()));
  assert.equal(assets.length, 1);
  assert.equal(assets[0].category, 'emoji');
  assert.equal(assets[0].name, 'party');
  assert.equal(assets[0].sourcePath, 'emojis/party!.png');
});

test('accepts 320 by 320 PNG stickers from the stickers folder', async () => {
  const assets = await parsePackArchive(zipWithFile('stickers/hello.png', png320()));
  assert.equal(assets.length, 1);
  assert.equal(assets[0].category, 'sticker');
});
