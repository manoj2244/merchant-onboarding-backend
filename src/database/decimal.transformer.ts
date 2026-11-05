import { ValueTransformer } from 'typeorm';

/** pg returns NUMERIC as string to avoid precision loss; amounts here fit safely in a JS number. */
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};
