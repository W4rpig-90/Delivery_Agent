/**
 * businessHours.js — verifica si el negocio está abierto según los horarios configurados.
 * Colombia = UTC-5, sin horario de verano.
 */

const settingsRepo = require("../repositories/settings.repo");

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = {
  mon: "Lunes", tue: "Martes", wed: "Miércoles",
  thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo",
};

function nowBogota() {
  const utcMs = Date.now() - 5 * 3600 * 1000;
  const d = new Date(utcMs);
  return { day: DAYS[d.getUTCDay()], minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function getHours() {
  try {
    const raw = settingsRepo.getSetting("business_hours");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function isOpen() {
  const hours = getHours();
  if (!hours) return true; // sin configuración = siempre abierto
  const { day, minutes } = nowBogota();
  const cfg = hours[day];
  if (!cfg || !cfg.enabled) return false;
  const [oh, om] = cfg.open.split(":").map(Number);
  const [ch, cm] = cfg.close.split(":").map(Number);
  return minutes >= oh * 60 + om && minutes < ch * 60 + cm;
}

function closedMessage() {
  const hours = getHours();
  const DAYS_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  let schedule = "";
  if (hours) {
    schedule = DAYS_ORDER
      .filter(d => hours[d]?.enabled)
      .map(d => `  • *${DAY_LABELS[d]}*: ${hours[d].open} – ${hours[d].close}`)
      .join("\n");
  }
  return [
    "¡Hola! 👋 En este momento nuestro local está *cerrado*. 🕐",
    "",
    "Nuestro horario de atención:",
    schedule || "  Por confirmar",
    "",
    "Escríbenos en horario de atención y con gusto te atendemos. 😊",
  ].join("\n");
}

module.exports = { isOpen, getHours, closedMessage };
