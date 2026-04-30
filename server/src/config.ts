import { resolve } from 'node:path';

export const WRITERSIDE_DIR = process.env.MANIFEST_WRITERSIDE_DIR
  ? resolve(process.env.MANIFEST_WRITERSIDE_DIR)
  : resolve(import.meta.dirname, '../../../ManifestAndroid/Writerside');
