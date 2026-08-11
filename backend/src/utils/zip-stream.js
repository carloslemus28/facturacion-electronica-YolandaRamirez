const { once } = require('events');
const zlib = require('zlib');

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }

    table[n] = c >>> 0;
  }

  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const sanitizeZipPath = (value) => {
  return String(value || 'archivo')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment
      .replace(/[\u0000-\u001f<>:"|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'archivo')
    .join('/');
};

const dateToDos = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  const year = Math.max(1980, safeDate.getFullYear());
  const month = safeDate.getMonth() + 1;
  const day = safeDate.getDate();
  const hours = safeDate.getHours();
  const minutes = safeDate.getMinutes();
  const seconds = Math.floor(safeDate.getSeconds() / 2);

  return {
    time: ((hours << 11) | (minutes << 5) | seconds) & 0xffff,
    date: (((year - 1980) << 9) | (month << 5) | day) & 0xffff
  };
};

class ZipStreamWriter {
  constructor(stream) {
    this.stream = stream;
    this.entries = [];
    this.offset = 0;
  }

  async write(buffer) {
    this.offset += buffer.length;

    if (!this.stream.write(buffer)) {
      await once(this.stream, 'drain');
    }
  }

  async addFile(path, content, modifiedAt = new Date()) {
    const fileName = sanitizeZipPath(path);
    const nameBuffer = Buffer.from(fileName, 'utf8');
    const fileBuffer = Buffer.isBuffer(content)
      ? content
      : Buffer.from(String(content || ''), 'utf8');
    const deflatedBuffer = zlib.deflateRawSync(fileBuffer, { level: 6 });
    const shouldCompress = deflatedBuffer.length < fileBuffer.length;
    const outputBuffer = shouldCompress ? deflatedBuffer : fileBuffer;
    const compressionMethod = shouldCompress ? 8 : 0;

    const { time, date } = dateToDos(modifiedAt);
    const checksum = crc32(fileBuffer);
    const size = fileBuffer.length;
    const compressedSize = outputBuffer.length;
    const localHeaderOffset = this.offset;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    await this.write(localHeader);
    await this.write(nameBuffer);
    await this.write(outputBuffer);

    this.entries.push({
      nameBuffer,
      checksum,
      size,
      compressedSize,
      compressionMethod,
      time,
      date,
      localHeaderOffset
    });
  }

  async finalize() {
    const centralDirectoryStart = this.offset;

    for (const entry of this.entries) {
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(entry.compressionMethod, 10);
      centralHeader.writeUInt16LE(entry.time, 12);
      centralHeader.writeUInt16LE(entry.date, 14);
      centralHeader.writeUInt32LE(entry.checksum, 16);
      centralHeader.writeUInt32LE(entry.compressedSize, 20);
      centralHeader.writeUInt32LE(entry.size, 24);
      centralHeader.writeUInt16LE(entry.nameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(entry.localHeaderOffset, 42);

      await this.write(centralHeader);
      await this.write(entry.nameBuffer);
    }

    const centralDirectorySize = this.offset - centralDirectoryStart;
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(this.entries.length, 8);
    endRecord.writeUInt16LE(this.entries.length, 10);
    endRecord.writeUInt32LE(centralDirectorySize, 12);
    endRecord.writeUInt32LE(centralDirectoryStart, 16);
    endRecord.writeUInt16LE(0, 20);

    await this.write(endRecord);
    this.stream.end();
  }
}

const createZipStreamWriter = (stream) => new ZipStreamWriter(stream);

module.exports = {
  createZipStreamWriter,
  sanitizeZipPath
};
