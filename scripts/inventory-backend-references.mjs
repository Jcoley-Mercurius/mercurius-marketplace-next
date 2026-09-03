import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const liveSchemaArgument = process.argv.indexOf("--live-schema");
const liveSchemaPath =
  liveSchemaArgument >= 0 ? process.argv[liveSchemaArgument + 1] : undefined;

async function walk(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute, extensions)));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }

  return files;
}

function collect(text, expression, group = 1) {
  return [...text.matchAll(expression)].map((match) => match[group]);
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeIdentifier(value) {
  return value.replaceAll('"', "");
}

function maskDollarQuotedBodies(value) {
  return value.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g,
    (body) => body.replace(/[^\r\n]/g, " "),
  );
}

function topLevelDml(file, sql) {
  const executable = maskDollarQuotedBodies(sql);
  const expression =
    /^\s*(insert\s+into|update|delete\s+from|copy)\s+([^\s(]+)/gim;
  return [...executable.matchAll(expression)].map((match) => ({
    file: path.relative(root, file).replaceAll("\\", "/"),
    line: executable.slice(0, match.index).split(/\r?\n/).length,
    operation: match[1].replace(/\s+/g, " ").toUpperCase(),
    target: normalizeIdentifier(match[2]),
  }));
}

const sourceFiles = [
  ...(await walk(path.join(root, "src"), new Set([".ts", ".tsx"]))),
  ...(await walk(path.join(root, "supabase", "functions"), new Set([".ts", ".tsx"]))),
].filter((file) => !file.endsWith("database.types.ts"));
const migrationFiles = await walk(
  path.join(root, "supabase", "migrations"),
  new Set([".sql"]),
);

const source = (
  await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))
).join("\n");
const migrations = (
  await Promise.all(migrationFiles.map((file) => readFile(file, "utf8")))
).join("\n");
const migrationContents = await Promise.all(
  migrationFiles.map(async (file) => ({ file, sql: await readFile(file, "utf8") })),
);

const referencedRelations = unique(
  collect(source, /\.from\(["']([^"']+)["']\)/g),
);
const referencedFunctions = unique(
  collect(source, /\.rpc\(["']([^"']+)["']/g),
);
const referencedEdgeFunctions = unique(
  collect(source, /\.functions\.invoke\(\s*["']([^"']+)["']/g),
);
const committedEdgeFunctions = unique(
  (await readdir(path.join(root, "supabase", "functions"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name),
);
const createdTables = unique(
  collect(
    migrations,
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  ),
);
const createdFunctions = unique(
  collect(
    migrations,
    /create\s+or\s+replace\s+function\s+(?:(?:public|private)\.)?([a-z_][a-z0-9_]*)/gi,
  ),
);

const inventory = {
  generatedFrom: {
    sourceFiles: sourceFiles.length,
    migrationFiles: migrationFiles.length,
  },
  topLevelMigrationDml: migrationContents.flatMap(({ file, sql }) =>
    topLevelDml(file, sql),
  ),
  referencedRelations,
  referencedFunctions,
  referencedEdgeFunctions,
  committedEdgeFunctions,
  referencedEdgeFunctionsWithoutCommittedSource: referencedEdgeFunctions.filter(
    (name) => !committedEdgeFunctions.includes(name),
  ),
  createdTables,
  createdFunctions,
  referencedRelationsWithoutCommittedCreate: referencedRelations.filter(
    (name) => !createdTables.includes(name),
  ),
  referencedFunctionsWithoutCommittedCreate: referencedFunctions.filter(
    (name) => !createdFunctions.includes(name),
  ),
};

if (liveSchemaPath) {
  const liveSchema = await readFile(path.resolve(root, liveSchemaPath), "utf8");
  const liveTables = unique(
    collect(
      liveSchema,
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)[\s(]/gim,
    ).map(normalizeIdentifier),
  );
  const liveFunctions = unique(
    collect(
      liveSchema,
      /^create\s+(?:or\s+replace\s+)?function\s+([^\s(]+)[\s(]/gim,
    ).map((name) => normalizeIdentifier(name).split(".").at(-1)),
  );

  inventory.liveSchema = {
    path: liveSchemaPath,
    bytes: Buffer.byteLength(liveSchema),
    copyStatements: collect(liveSchema, /^copy\s+/gim, 0).length,
    insertStatements: collect(liveSchema, /^insert\s+into\s+/gim, 0).length,
    tables: liveTables,
    functions: liveFunctions,
    types: unique(
      collect(liveSchema, /^create\s+type\s+([^\s]+)\s+as/gim).map(
        normalizeIdentifier,
      ),
    ),
    sequences: unique(
      collect(
        liveSchema,
        /^create\s+sequence\s+(?:if\s+not\s+exists\s+)?([^\s;]+)/gim,
      ).map(normalizeIdentifier),
    ),
    triggerCount: collect(
      liveSchema,
      /^create\s+(?:or\s+replace\s+)?trigger\s+/gim,
      0,
    ).length,
    policyCount: collect(liveSchema, /^create\s+policy\s+/gim, 0).length,
    extensionCount: collect(
      liveSchema,
      /^create\s+extension\s+/gim,
      0,
    ).length,
    referencedRelationsAbsentFromLiveExport: referencedRelations.filter(
      (name) => !liveTables.includes(`public.${name}`),
    ),
    referencedFunctionsAbsentFromLiveExport: referencedFunctions.filter(
      (name) => !liveFunctions.includes(name),
    ),
  };
}

process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
