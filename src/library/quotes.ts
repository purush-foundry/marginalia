// Short reading quotations, each tied to a named work, and a seeded picker.
export interface Quote {
  text: string
  author: string
  source: string
}

export const QUOTES: readonly Quote[] = [
  { text: 'Reading maketh a full man; conference a ready man; and writing an exact man.', author: 'Francis Bacon', source: 'Of Studies' },
  { text: 'Books must be read as deliberately and reservedly as they were written.', author: 'Henry David Thoreau', source: 'Walden' },
  { text: 'Books are the best of things, well used; abused, among the worst.', author: 'Ralph Waldo Emerson', source: 'The American Scholar' },
  { text: 'Studies serve for delight, for ornament, and for ability.', author: 'Francis Bacon', source: 'Of Studies' },
  { text: 'Crafty men contemn studies, simple men admire them, and wise men use them.', author: 'Francis Bacon', source: 'Of Studies' },
  { text: 'Books are the best type of the influence of the past.', author: 'Ralph Waldo Emerson', source: 'The American Scholar' },
  { text: 'A book must be the axe for the frozen sea within us.', author: 'Franz Kafka', source: 'Letter to Oskar Pollak' },
  { text: 'A reader lives a thousand lives before he dies.', author: 'George R. R. Martin', source: 'A Dance with Dragons' },
]

export function pickQuote(seed: number): Quote {
  const n = QUOTES.length
  return QUOTES[(((Math.floor(seed) % n) + n) % n)]
}
