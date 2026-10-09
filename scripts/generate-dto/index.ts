#!/usr/bin/env npx tsx
/**
 * Prisma-to-DTO Generator
 *
 * Parses web-1/src/prisma/schema.prisma and generates
 * .shared-kernel/models/db_models.generated.dto.ts
 *
 * Usage: npm run system:generate-dto
 *        npm run system:generate-dto -- --out /tmp/regen.dto.ts   (freshness diff, audit:dto)
 */

import fs from 'node:fs'
import path from 'node:path'
import {getSchema, type Schema, type Model, type Enum, type Field, type Attribute} from '@mrleebo/prisma-ast'
import {
  PRISMA_TYPE_MAP,
  MODEL_NAME_OVERRIDES,
  SKIP_ENUMS,
  FIELD_TYPE_OVERRIDES,
  GENERATED_FILE_IMPORTS,
  ID_FIELD_PATTERNS,
  ID_CAPABLE_SCALAR_TYPES,
} from './config'

// ============================================================
// Paths
// ============================================================

const ROOT = path.resolve(import.meta.dirname, '../..')
const SCHEMA_PATH = path.join(ROOT, 'web-1/src/prisma/schema.prisma')
const DEFAULT_OUTPUT_PATH = path.join(ROOT, '.shared-kernel/models/db_models.generated.dto.ts')

// `--out <path>` redirects output (used by audit:dto to regen into a temp file
// and diff against the committed kernel DTO — the committed file is never touched).
function resolveOutputPath(): string {
  const flagIndex = process.argv.indexOf('--out')
  const custom = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (flagIndex !== -1 && !custom) {
    console.error('--out requires a path argument')
    process.exit(1)
  }
  return custom ? path.resolve(custom) : DEFAULT_OUTPUT_PATH
}

const OUTPUT_PATH = resolveOutputPath()

// ============================================================
// Parser helpers
// ============================================================

function isField(prop: {type: string}): prop is Field {
  return prop.type === 'field'
}

function hasAttribute(field: Field, attrName: string): boolean {
  return field.attributes?.some((a: Attribute) => a.name === attrName) ?? false
}

function isRelation(field: Field, modelNames: ReadonlySet<string>): boolean {
  const ft = typeof field.fieldType === 'string' ? field.fieldType : ''
  return modelNames.has(ft)
}

function isIdField(field: Field): boolean {
  return hasAttribute(field, 'id')
}

function isIdLikeIntField(fieldName: string): boolean {
  return ID_FIELD_PATTERNS.some(p => p.test(fieldName))
}

// ============================================================
// DateMetadata detection
// ============================================================

function getScalarFields(model: Model): Field[] {
  return model.properties.filter((p): p is Field => isField(p))
}

function hasCreatedAt(fields: Field[]): boolean {
  return fields.some(f => f.name === 'created_at' && f.fieldType === 'DateTime' && !f.optional)
}

function hasUpdatedAt(fields: Field[]): boolean {
  return fields.some(f => f.name === 'updated_at' && hasAttribute(f, 'updatedAt'))
}

type MetadataKind = 'none' | 'DateMetadata' | 'DateMetadataWithUpdate'

function detectMetadata(fields: Field[]): MetadataKind {
  if (!hasCreatedAt(fields)) return 'none'
  if (hasUpdatedAt(fields)) return 'DateMetadataWithUpdate'
  return 'DateMetadata'
}

function isMetadataField(name: string, kind: MetadataKind): boolean {
  if (kind !== 'none' && name === 'created_at') return true
  if (kind === 'DateMetadataWithUpdate' && name === 'updated_at') return true
  return false
}

// ============================================================
// Type mapping
// ============================================================

function mapFieldType(
  field: Field,
  modelName: string,
  enumNames: ReadonlySet<string>,
): string {
  const ft = typeof field.fieldType === 'string' ? field.fieldType : ''

  // Field type override (e.g. Trait.category → TraitCategory)
  const override = FIELD_TYPE_OVERRIDES[modelName]?.[field.name]
  if (override) {
    return field.array ? `${override}[]` : override
  }

  // @id fields → IDStringType (String) / rzeczywisty skalar (Int, BigInt)
  // DECISION (nie usuwaj tego komentarza):
  // IDType i IDStringType sa aliasami `string` (application.types.ts), wiec wolno
  // ich uzywac WYLACZNIE dla pol String. `Int @id @default(autoincrement())`
  // (NewsletterConsentEvent.id) Prisma zwraca jako `number` — mapowanie go na
  // IDType deklarowaloby `string` i cicho klamalo w SSOT, ktore ma odwzorowywac
  // modele Prisma 1:1. Nie "naprawiac" z powrotem na jednolite IDType.
  if (isIdField(field)) {
    if (ft === 'String') return 'IDStringType'
    return PRISMA_TYPE_MAP[ft] ?? 'IDType'
  }

  // Enum references
  if (enumNames.has(ft)) {
    return field.array ? `${ft}[]` : ft
  }

  // Standard type mapping
  const mapped = PRISMA_TYPE_MAP[ft]
  // Unknown → use as-is (np. enum ze SKIP_ENUMS: PricingPlan zdefiniowany w kernelu).
  // `field.array` MUSI byc uwzgledniony takze tutaj — bez tego `PricingPlan[]`
  // wygenerowaloby sie jako `PricingPlan`: typ, ktory sie KOMPILUJE i klamie.
  if (!mapped) return field.array ? `${ft}[]` : ft

  // ID-like fields: foreign key pattern (Int or String).
  // Int FK dostaje `number` z tego samego powodu co Int @id wyzej — IDType == string.
  if (ID_CAPABLE_SCALAR_TYPES.has(ft) && isIdLikeIntField(field.name)) {
    const idAlias = ft === 'String' ? 'IDType' : mapped
    return field.array ? `${idAlias}[]` : idAlias
  }

  // Array fields
  if (field.array) {
    return `${mapped}[]`
  }

  return mapped
}

// ============================================================
// Code generation
// ============================================================

function generateImports(): string {
  const lines = GENERATED_FILE_IMPORTS.map(imp => {
    const typeList = imp.types.join(', ')
    return `import type {${typeList}} from '${imp.from}'`
  })
  return lines.join('\n')
}

function generateEnum(enumDef: Enum): string {
  const constName = `${enumDef.name}Value`
  const typeName = enumDef.name

  const enumerators = enumDef.enumerators
    .filter((e): e is {type: 'enumerator'; name: string} => 'name' in e && e.type === 'enumerator')

  const entries = enumerators.map(e => `  ${e.name}: '${e.name}'`).join(',\n')

  return [
    `export const ${constName} = Object.freeze({`,
    entries,
    '} as const)',
    `export type ${typeName} = ValueOf<typeof ${constName}>`,
  ].join('\n')
}

function generateModel(
  model: Model,
  modelNames: ReadonlySet<string>,
  enumNames: ReadonlySet<string>,
): string {
  const dtoName = MODEL_NAME_OVERRIDES[model.name] ?? model.name
  const allFields = getScalarFields(model)

  // Filter: only scalar fields (not relations)
  const scalarFields = allFields.filter(f => !isRelation(f, modelNames))

  // Detect DateMetadata pattern
  const metadata = detectMetadata(scalarFields)

  // Generate field lines (skip metadata fields — they come from intersection)
  const fieldLines = scalarFields
    .filter(f => !isMetadataField(f.name, metadata))
    .map(f => {
      const tsType = mapFieldType(f, model.name, enumNames)
      const nullable = f.optional ? ' | null' : ''
      return `  ${f.name}: ${tsType}${nullable}`
    })

  // Build type definition
  const intersection = metadata !== 'none' ? ` & ${metadata}` : ''
  const body = fieldLines.join('\n')

  return `export type ${dtoName} = {\n${body}\n}${intersection}`
}

// ============================================================
// Main orchestration
// ============================================================

function generate(): string {
  // Parse schema
  const source = fs.readFileSync(SCHEMA_PATH, 'utf-8')
  const schema: Schema = getSchema(source)

  // Collect models and enums
  const models = schema.list.filter((b): b is Model => b.type === 'model')
  const enums = schema.list.filter((b): b is Enum => b.type === 'enum')
    .filter(e => !SKIP_ENUMS.has(e.name))

  const modelNames = new Set(models.map(m => m.name))
  const enumNames = new Set(enums.map(e => e.name))

  // Sanity-check: schema bez modeli parsuje sie BEZ bledu (pusty/obciety plik daje
  // models=0 — zweryfikowane probem prisma-ast). Bez tego guardu generator nadpisalby
  // SSOT-DTO pustka i zameldowal sukces, a `system:kernel` rozniosl ja do obu submodulow.
  if (models.length === 0) {
    console.error(`Refusing to write: parsed 0 models from ${path.relative(ROOT, SCHEMA_PATH)} — schema empty or unreadable.`)
    process.exit(1)
  }

  const skippedEnums = schema.list.filter((b): b is Enum => b.type === 'enum').length - enums.length
  console.log(`Found ${models.length} models, ${enums.length} enums (${skippedEnums} skipped)`)

  // Generate file content
  const header = [
    '// AUTO-GENERATED FROM PRISMA SCHEMA — DO NOT EDIT MANUALLY',
    '// Source: web-1/src/prisma/schema.prisma',
    '// Regenerate: npm run system:generate-dto',
    '//',
    '// This file contains types that map 1:1 to Prisma models and enums.',
    '// Manual/business types are in db_models.manual.dto.ts',
  ].join('\n')

  const imports = generateImports()

  const enumSection = [
    '// ============================================================',
    '// ENUMS (from Prisma schema)',
    '// ============================================================',
    '',
    enums.map(generateEnum).join('\n\n'),
  ].join('\n')

  const modelSection = [
    '// ============================================================',
    '// MODEL TYPES (from Prisma schema)',
    '// ============================================================',
    '',
    models.map(m => generateModel(m, modelNames, enumNames)).join('\n\n'),
  ].join('\n')

  return [header, '', imports, '', enumSection, '', modelSection, ''].join('\n')
}

// ============================================================
// CLI
// ============================================================

function main() {
  console.log('Parsing Prisma schema...')
  const generated = generate()

  // Compare with existing file
  if (fs.existsSync(OUTPUT_PATH)) {
    const existing = fs.readFileSync(OUTPUT_PATH, 'utf-8')
    if (existing === generated) {
      console.log('No changes detected — generated file is up to date.')
      return
    }
    console.log('Changes detected — updating generated file.')
  } else {
    console.log('Creating generated file for the first time.')
  }

  fs.writeFileSync(OUTPUT_PATH, generated, 'utf-8')
  console.log(`Written to: ${path.relative(ROOT, OUTPUT_PATH)}`)
}

main()
