const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})

export const naturalSort = <T>(items: T[], selector: (item: T) => string): T[] =>
  [...items].sort((left, right) => collator.compare(selector(left), selector(right)))
