/**
 * uploadService.js — recepción y optimización de imágenes (productos y QR de pago).
 *
 * - multer en memoria (no escribe temporales).
 * - sharp redimensiona y comprime: productos → webp (ligero para la tablet),
 *   QR → png (sin pérdida, para que sea escaneable).
 * - Si sharp no estuviera disponible, guarda el archivo original como fallback.
 *
 * Las imágenes viven en data/uploads/{products,qr} y se sirven en /uploads/...
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

let sharp = null;
try { sharp = require("sharp"); } catch { console.warn("[upload] sharp no disponible — se guardarán imágenes sin optimizar."); }

const UPLOADS_DIR = path.resolve(__dirname, "..", "..", "data", "uploads");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("solo se permiten imágenes (jpg, png, webp, gif)"));
  }
});

/**
 * Procesa y guarda una imagen.
 * @param {Buffer} buffer  contenido del archivo subido
 * @param {"products"|"qr"} subdir
 * @returns {Promise<string>} ruta pública relativa, p.ej. "/uploads/products/ab12.webp"
 */
async function processAndSave(buffer, subdir) {
  const dir = path.join(UPLOADS_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const base = crypto.randomBytes(8).toString("hex");

  if (sharp) {
    if (subdir === "qr") {
      const file = `${base}.png`;
      await sharp(buffer).resize({ width: 600, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(path.join(dir, file));
      return `/uploads/${subdir}/${file}`;
    }
    const file = `${base}.webp`;
    await sharp(buffer).resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(dir, file));
    return `/uploads/${subdir}/${file}`;
  }

  // Fallback sin sharp: guarda los bytes tal cual (asume jpeg/png)
  const file = `${base}.img`;
  fs.writeFileSync(path.join(dir, file), buffer);
  return `/uploads/${subdir}/${file}`;
}

/** Borra una imagen previa por su ruta pública (best-effort). */
function removeByPublicPath(publicPath) {
  if (!publicPath || !publicPath.startsWith("/uploads/")) return;
  const abs = path.join(UPLOADS_DIR, publicPath.replace("/uploads/", ""));
  fs.promises.unlink(abs).catch(() => {});
}

module.exports = { upload, processAndSave, removeByPublicPath, UPLOADS_DIR };
