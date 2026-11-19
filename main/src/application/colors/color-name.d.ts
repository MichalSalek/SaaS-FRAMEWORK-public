declare module 'color-name' {
  const colors: Readonly<
    Partial<Record<string, readonly [number, number, number]>>
  >;
  export = colors;
}
