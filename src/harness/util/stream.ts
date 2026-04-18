export const collectAsync = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];

  for await (const value of iterable) {
    values.push(value);
  }

  return values;
};
