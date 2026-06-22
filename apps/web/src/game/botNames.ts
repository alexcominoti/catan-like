/**
 * Nomes inspirados na mitologia celta (irlandesa/galesa) para os bots. O genero
 * fica guardado (m/f) pois no futuro cada bot tera um avatar correspondente.
 * Inspirado no post r/namenerds "Names inspired by Celtic mythology".
 */
export interface BotName {
  name: string;
  gender: 'm' | 'f';
}

export const BOT_NAMES: BotName[] = [
  // Femininos
  { name: 'Aoife', gender: 'f' },
  { name: 'Brigid', gender: 'f' },
  { name: 'Deirdre', gender: 'f' },
  { name: 'Étaín', gender: 'f' },
  { name: 'Fionnuala', gender: 'f' },
  { name: 'Gráinne', gender: 'f' },
  { name: 'Maeve', gender: 'f' },
  { name: 'Niamh', gender: 'f' },
  { name: 'Rhiannon', gender: 'f' },
  { name: 'Áine', gender: 'f' },
  { name: 'Clíodhna', gender: 'f' },
  { name: 'Eithne', gender: 'f' },
  { name: 'Branwen', gender: 'f' },
  { name: 'Ceridwen', gender: 'f' },
  { name: 'Scáthach', gender: 'f' },
  { name: 'Emer', gender: 'f' },
  { name: 'Arianrhod', gender: 'f' },
  { name: 'Olwen', gender: 'f' },
  { name: 'Macha', gender: 'f' },
  // Masculinos
  { name: 'Aengus', gender: 'm' },
  { name: 'Bran', gender: 'm' },
  { name: 'Conall', gender: 'm' },
  { name: 'Conor', gender: 'm' },
  { name: 'Cormac', gender: 'm' },
  { name: 'Cúchulainn', gender: 'm' },
  { name: 'Diarmuid', gender: 'm' },
  { name: 'Fergus', gender: 'm' },
  { name: 'Fionn', gender: 'm' },
  { name: 'Lugh', gender: 'm' },
  { name: 'Manannán', gender: 'm' },
  { name: 'Nuada', gender: 'm' },
  { name: 'Oisín', gender: 'm' },
  { name: 'Oscar', gender: 'm' },
  { name: 'Cian', gender: 'm' },
  { name: 'Lir', gender: 'm' },
  { name: 'Ogma', gender: 'm' },
  { name: 'Pryderi', gender: 'm' },
  { name: 'Gwydion', gender: 'm' },
  { name: 'Taliesin', gender: 'm' },
];

/** Sorteia um nome de bot ainda nao usado (ou um qualquer, se todos usados). */
export function pickBotName(used: string[]): BotName {
  const free = BOT_NAMES.filter((b) => !used.includes(b.name));
  const pool = free.length > 0 ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
