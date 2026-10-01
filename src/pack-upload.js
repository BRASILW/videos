const yauzl = require('yauzl');

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BYTES = 512 * 1024;
const MAX_ARCHIVE_ENTRIES = 150;
const MAX_ASSETS = 100;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const EMOJI_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif']);
const STICKER_EXTENSIONS = new Set(['.png', '.apng']);

function getPackCategory(entryPath) {
  const pathParts = entryPath.split('/');
  const category = pathParts[0]?.toLowerCase();
  if (category === 'emojis' || category === 'emoji') return 'emoji';
  if (category === 'stickers' || category === 'sticker') return 'sticker';
  return null;
}

function isSafeZipPath(entryPath) {
  return Boolean(
    entryPath &&
    !entryPath.startsWith('/') &&
    !entryPath.includes('\\') &&
    !entryPath.split('/').some(part => part === '..' || part === '.')
  );
}

function imageMatchesType(buffer, extension, category) {
  const isPng = buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (category === 'sticker') return isPng && STICKER_EXTENSIONS.has(extension);
  if (extension === '.png') return isPng;
  if (extension === '.jpg' || extension === '.jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === '.gif') {
    return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  }
  return false;
}

function hasStickerDimensions(buffer) {
  return buffer.length >= 24 &&
    buffer.readUInt32BE(16) === 320 &&
    buffer.readUInt32BE(20) === 320;
}

function normalizeAssetName(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const normalized = baseName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return normalized.length >= 2 ? normalized : null;
}

function readEntry(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let size = 0;
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_ASSET_BYTES) {
          stream.destroy(new Error('Arquivo acima do limite de 512 KiB.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function parsePackArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error('O ZIP precisa ter entre 1 byte e 10 MiB.');
  }

  const zipFile = await yauzl.fromBufferPromise(buffer, {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true
  });

  const assets = [];
  let entriesSeen = 0;
  let uncompressedBytes = 0;

  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.once('end', () => {
      if (settled) return;
      settled = true;
      zipFile.close();
      resolve();
    });
    zipFile.on('close', () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    zipFile.on('entry', entry => {
      (async () => {
        entriesSeen += 1;
        if (entriesSeen > MAX_ARCHIVE_ENTRIES) {
          throw new Error(`O ZIP pode conter no máximo ${MAX_ARCHIVE_ENTRIES} itens.`);
        }
        if (entry.fileName.endsWith('/')) {
          zipFile.readEntry();
          return;
        }
        if (!isSafeZipPath(entry.fileName)) {
          zipFile.readEntry();
          return;
        }

        const category = getPackCategory(entry.fileName);
        const extension = entry.fileName.slice(entry.fileName.lastIndexOf('.')).toLowerCase();
        const supportedExtension = category === 'emoji'
          ? EMOJI_EXTENSIONS.has(extension)
          : category === 'sticker'
            ? STICKER_EXTENSIONS.has(extension)
            : false;

        if (!category || !supportedExtension || entry.uncompressedSize > MAX_ASSET_BYTES) {
          zipFile.readEntry();
          return;
        }
        if (entry.generalPurposeBitFlag & 0x1) {
          zipFile.readEntry();
          return;
        }

        uncompressedBytes += entry.uncompressedSize;
        if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES || assets.length >= MAX_ASSETS) {
          throw new Error(`O pack pode conter no máximo ${MAX_ASSETS} imagens e ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MiB descompactados.`);
        }

        const fileData = await readEntry(zipFile, entry);
        if (!imageMatchesType(fileData, extension, category)) {
          zipFile.readEntry();
          return;
        }
        if (category === 'sticker' && !hasStickerDimensions(fileData)) {
          zipFile.readEntry();
          return;
        }

        const name = normalizeAssetName(entry.fileName.split('/').pop());
        if (name) assets.push({ category, name, fileData, sourcePath: entry.fileName });
        zipFile.readEntry();
      })().catch(fail);
    });
    zipFile.readEntry();
  });

  if (!assets.length) {
    throw new Error('Não encontrei imagens válidas. Use `emojis/` e/ou `stickers/`; figurinhas PNG devem ter 320×320 pixels.');
  }
  return assets;
}

async function downloadPack(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Não foi possível baixar o anexo (HTTP ${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_ARCHIVE_BYTES) throw new Error('O ZIP não pode passar de 10 MiB.');

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_ARCHIVE_BYTES) {
      throw new Error('O ZIP não pode passar de 10 MiB.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function uniqueName(name, takenNames) {
  if (!takenNames.has(name)) {
    takenNames.add(name);
    return name;
  }
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${name.slice(0, 32 - String(suffix).length - 1)}_${suffix}`;
    if (!takenNames.has(candidate)) {
      takenNames.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Não foi possível gerar um nome único para ${name}.`);
}

async function uploadPack(guild, archiveBuffer) {
  const assets = await parsePackArchive(archiveBuffer);
  const existingEmojis = await guild.emojis.fetch();
  const existingStickers = await guild.stickers.fetch();
  const emojiNames = new Set(existingEmojis.map(emoji => emoji.name));
  const stickerNames = new Set(existingStickers.map(sticker => sticker.name));
  const results = { created: [], failed: [] };

  for (const asset of assets) {
    try {
      const takenNames = asset.category === 'emoji' ? emojiNames : stickerNames;
      const name = uniqueName(asset.name, takenNames);
      const created = asset.category === 'emoji'
        ? await guild.emojis.create({
            attachment: asset.fileData,
            name,
            reason: 'Importação de pack solicitada por administrador'
          })
        : await guild.stickers.create({
            file: {
              attachment: asset.fileData,
              name: `${name}.png`
            },
            name,
            tags: 'smile',
            description: `Figurinha ${name}`.slice(0, 100),
            reason: 'Importação de pack solicitada por administrador'
          });
      results.created.push({ category: asset.category, name: created.name });
    } catch (error) {
      results.failed.push({ category: asset.category, name: asset.name, reason: error.message });
    }
  }
  return results;
}

function summarizeUploadResults(results) {
  const emojiCount = results.created.filter(item => item.category === 'emoji').length;
  const stickerCount = results.created.filter(item => item.category === 'sticker').length;
  const failed = results.failed.slice(0, 8).map(item =>
    `• ${item.category === 'emoji' ? 'Emoji' : 'Figurinha'} \`${item.name}\`: ${item.reason.slice(0, 120)}`
  );
  const omitted = results.failed.length > failed.length
    ? `\n… mais ${results.failed.length - failed.length} erro(s).`
    : '';
  return [
    `✅ Importação concluída: **${emojiCount} emoji(s)** e **${stickerCount} figurinha(s)** criados.`,
    results.failed.length ? `⚠️ ${results.failed.length} arquivo(s) falharam:\n${failed.join('\n')}${omitted}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = {
  downloadPack,
  getPackCategory,
  hasStickerDimensions,
  imageMatchesType,
  normalizeAssetName,
  parsePackArchive,
  summarizeUploadResults,
  uploadPack
};
