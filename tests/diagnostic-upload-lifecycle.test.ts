import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import type { ReportEntry, TemplateSchema } from "../lib/diagnostics";

type FakeStore = {
  validateUpload: (file: File) => void;
  saveUpload: (
    file: File,
    subdir: string,
  ) => Promise<{ path: string; size: number; mime: string }>;
  deleteUpload: (urlPath: string) => Promise<void>;
};

type CollectedValidatedReportData = {
  data: Record<string, ReportEntry>;
  signatureUrl: string | null;
  uploadedPaths: string[];
};

type CollectValidatedReportData = (
  formData: FormData,
  schema: TemplateSchema,
  store?: FakeStore,
) => Promise<CollectedValidatedReportData>;

type CommitWithReportUploadCleanup = <Result>(
  uploadedPaths: string[],
  commit: () => Promise<Result>,
  isSuccess?: (result: Result) => boolean,
  deleteUpload?: (urlPath: string) => Promise<void>,
) => Promise<Result>;

type DiagnosticsServerModule = {
  collectValidatedReportData?: CollectValidatedReportData;
  commitWithReportUploadCleanup?: CommitWithReportUploadCleanup;
};

const schema: TemplateSchema = {
  sections: [
    {
      id: "inspection",
      title: "Inspection",
      items: [
        {
          id: "required-text",
          label: "Required text",
          type: "text",
          required: true,
        },
        { id: "photos", label: "Photos", type: "photo", required: false },
      ],
    },
  ],
};

let diagnosticsServer: DiagnosticsServerModule;

before(async () => {
  diagnosticsServer = (await import(
    "../lib/diagnostics-server"
  )) as unknown as DiagnosticsServerModule;
});

function requiredExport<K extends keyof DiagnosticsServerModule>(
  key: K,
): NonNullable<DiagnosticsServerModule[K]> {
  const value = diagnosticsServer[key];
  assert.equal(typeof value, "function", `${String(key)} must be exported`);
  return value as NonNullable<DiagnosticsServerModule[K]>;
}

function image(name: string, type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function createStore(
  options: {
    invalidName?: string;
    failingSaveName?: string;
    failingDeletePath?: string;
  } = {},
): FakeStore & {
  validations: string[];
  writes: string[];
  deletes: string[];
} {
  const validations: string[] = [];
  const writes: string[] = [];
  const deletes: string[] = [];
  return {
    validations,
    writes,
    deletes,
    validateUpload(file) {
      validations.push(file.name);
      if (file.name === options.invalidName) throw new Error("invalid upload");
    },
    async saveUpload(file, subdir) {
      writes.push(file.name);
      if (file.name === options.failingSaveName) throw new Error("save failed");
      return {
        path: `/uploads/${subdir}/${file.name}`,
        size: file.size,
        mime: file.type,
      };
    },
    async deleteUpload(urlPath) {
      deletes.push(urlPath);
      if (urlPath === options.failingDeletePath) throw new Error("delete failed");
    },
  };
}

test("required scalar validation finishes before the first upload write", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const store = createStore();
  const formData = new FormData();
  formData.append("photos[photos]", image("orphan.png"));

  await assert.rejects(collect(formData, schema, store), /Required text/);
  assert.deepEqual(store.writes, []);
  assert.deepEqual(store.deletes, []);
});

test("required photo and item-signature presence are checked before writes", async (t) => {
  const collect = requiredExport("collectValidatedReportData");
  const cases = [
    { id: "required-photo", type: "photo" as const },
    { id: "required-signature", type: "signature" as const },
  ];

  for (const item of cases) {
    await t.test(item.type, async () => {
      const requiredFileSchema: TemplateSchema = {
        sections: [
          {
            id: "files",
            title: "Files",
            items: [
              {
                id: item.id,
                label: item.id,
                type: item.type,
                required: true,
              },
              {
                id: "later-photo",
                label: "Later photo",
                type: "photo",
                required: false,
              },
            ],
          },
        ],
      };
      const store = createStore();
      const formData = new FormData();
      formData.append("photos[later-photo]", image("must-not-write.png"));

      await assert.rejects(
        collect(formData, requiredFileSchema, store),
        new RegExp(item.id),
      );
      assert.deepEqual(store.writes, []);
      assert.deepEqual(store.deletes, []);
    });
  }
});

test("every relevant file is validated before any upload is written", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const fileSchema: TemplateSchema = {
    sections: [
      {
        id: "files",
        title: "Files",
        items: [
          { id: "photos", label: "Photos", type: "photo", required: false },
          {
            id: "item-signature",
            label: "Item signature",
            type: "signature",
            required: false,
          },
        ],
      },
    ],
  };
  const store = createStore({ invalidName: "bad-overall-signature.png" });
  const formData = new FormData();
  formData.append("photos[photos]", image("good-photo.png"));
  formData.append(
    "signatures[item-signature]",
    image("good-item-signature.png"),
  );
  formData.append("signature", image("bad-overall-signature.png"));

  await assert.rejects(
    collect(formData, fileSchema, store),
    /invalid upload/,
  );
  assert.deepEqual(store.validations, [
    "good-photo.png",
    "good-item-signature.png",
    "bad-overall-signature.png",
  ]);
  assert.deepEqual(store.writes, []);
  assert.deepEqual(store.deletes, []);
});

test("hidden and non-schema file inputs are neither validated nor written", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const conditionalSchema: TemplateSchema = {
    sections: [
      {
        id: "conditional",
        title: "Conditional",
        items: [
          {
            id: "gate",
            label: "Gate",
            type: "check",
            required: true,
            options: ["show", "hide"],
          },
          {
            id: "conditional-photo",
            label: "Conditional photo",
            type: "photo",
            required: true,
            showWhen: { itemId: "gate", values: ["show"] },
          },
        ],
      },
    ],
  };
  const store = createStore();
  const formData = new FormData();
  formData.set("data[gate][value]", "hide");
  formData.append(
    "photos[conditional-photo]",
    image("hidden-must-not-write.png"),
  );
  formData.append("photos[unknown]", image("unknown-must-not-write.png"));
  formData.append(
    "signatures[unknown]",
    image("unknown-signature-must-not-write.png"),
  );
  formData.append(
    "photos[conditional-photo]",
    "/uploads/diagnostics/pre-existing.png",
  );

  const collected = await collect(formData, conditionalSchema, store);

  assert.deepEqual(collected.data, { gate: { value: "hide" } });
  assert.deepEqual(collected.uploadedPaths, []);
  assert.deepEqual(store.validations, []);
  assert.deepEqual(store.writes, []);
  assert.deepEqual(store.deletes, []);
});

test("a visible conditional file is validated, written, and persisted", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const conditionalSchema: TemplateSchema = {
    sections: [
      {
        id: "conditional",
        title: "Conditional",
        items: [
          {
            id: "gate",
            label: "Gate",
            type: "check",
            required: true,
            options: ["show", "hide"],
          },
          {
            id: "conditional-photo",
            label: "Conditional photo",
            type: "photo",
            required: true,
            showWhen: { itemId: "gate", values: ["show"] },
          },
        ],
      },
    ],
  };
  const store = createStore();
  const formData = new FormData();
  formData.set("data[gate][value]", "show");
  formData.append(
    "photos[conditional-photo]",
    image("visible-must-write.png"),
  );

  const collected = await collect(formData, conditionalSchema, store);

  assert.deepEqual(collected.data, {
    gate: { value: "show" },
    "conditional-photo": {
      photos: ["/uploads/diagnostics/visible-must-write.png"],
    },
  });
  assert.deepEqual(collected.uploadedPaths, [
    "/uploads/diagnostics/visible-must-write.png",
  ]);
  assert.deepEqual(store.validations, ["visible-must-write.png"]);
  assert.deepEqual(store.writes, ["visible-must-write.png"]);
  assert.deepEqual(store.deletes, []);
});

test("a partial upload failure removes only successfully created request paths", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const store = createStore({ failingSaveName: "second.png" });
  const formData = new FormData();
  formData.set("data[required-text][value]", "ok");
  formData.append("photos[photos]", image("first.png"));
  formData.append("photos[photos]", image("second.png"));

  await assert.rejects(collect(formData, schema, store), /save failed/);
  assert.deepEqual(store.validations, ["first.png", "second.png"]);
  assert.deepEqual(store.writes, ["first.png", "second.png"]);
  assert.deepEqual(store.deletes, ["/uploads/diagnostics/first.png"]);
});

test("partial-write cleanup failure does not mask the save failure", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const firstPath = "/uploads/diagnostics/first.png";
  const store = createStore({
    failingSaveName: "second.png",
    failingDeletePath: firstPath,
  });
  const formData = new FormData();
  formData.set("data[required-text][value]", "ok");
  formData.append("photos[photos]", image("first.png"));
  formData.append("photos[photos]", image("second.png"));

  await assert.rejects(collect(formData, schema, store), /save failed/);
  assert.deepEqual(store.deletes, [firstPath]);
});

test("successful collection returns validated data and a request-owned upload ledger", async () => {
  const collect = requiredExport("collectValidatedReportData");
  const store = createStore();
  const formData = new FormData();
  formData.set("data[required-text][value]", "  inspected  ");
  formData.append("photos[photos]", image("one.png"));
  formData.append("photos[photos]", image("two.png"));
  formData.append("signature", image("signature.png"));

  const collected = await collect(formData, schema, store);

  assert.deepEqual(collected.data, {
    "required-text": { value: "inspected" },
    photos: {
      photos: [
        "/uploads/diagnostics/one.png",
        "/uploads/diagnostics/two.png",
      ],
    },
  });
  assert.equal(
    collected.signatureUrl,
    "/uploads/diagnostics/signatures/signature.png",
  );
  assert.deepEqual(collected.uploadedPaths, [
    "/uploads/diagnostics/one.png",
    "/uploads/diagnostics/two.png",
    "/uploads/diagnostics/signatures/signature.png",
  ]);
  assert.deepEqual(store.deletes, []);
});

test("commit compensation cleans a non-success result and only its supplied ledger", async () => {
  const commit = requiredExport("commitWithReportUploadCleanup");
  const store = createStore();
  const requestPaths = [
    "/uploads/diagnostics/request-one.png",
    "/uploads/diagnostics/request-two.png",
  ];
  const rejected = { ok: false, status: 422 };

  const result = await commit(
    requestPaths,
    async () => rejected,
    (value: { ok: boolean }) => value.ok,
    store.deleteUpload,
  );

  assert.equal(result, rejected);
  assert.deepEqual(store.deletes, requestPaths);
  assert.ok(
    !store.deletes.includes("/uploads/diagnostics/pre-existing.png"),
  );
});

test("cleanup failure does not mask a primary non-success result", async () => {
  const commit = requiredExport("commitWithReportUploadCleanup");
  const path = "/uploads/diagnostics/request-owned.png";
  const store = createStore({ failingDeletePath: path });
  const rejected = { ok: false, status: 422 };

  const result = await commit(
    [path],
    async () => rejected,
    (value: { ok: boolean }) => value.ok,
    store.deleteUpload,
  );

  assert.equal(result, rejected);
  assert.deepEqual(store.deletes, [path]);
});

test("a successful commit keeps all request-owned uploads", async () => {
  const commit = requiredExport("commitWithReportUploadCleanup");
  const store = createStore();
  const accepted = { ok: true, status: 201 };

  const result = await commit(
    ["/uploads/diagnostics/request-owned.png"],
    async () => accepted,
    (value: { ok: boolean }) => value.ok,
    store.deleteUpload,
  );

  assert.equal(result, accepted);
  assert.deepEqual(store.deletes, []);
});

test("a locked transaction non-2xx response cleans request-owned uploads", async () => {
  const commit = requiredExport("commitWithReportUploadCleanup");
  const store = createStore();
  const response = new Response(null, { status: 422 });

  const result = await commit(
    ["/uploads/diagnostics/request-owned.png"],
    async () => response,
    (value: Response) => value.ok,
    store.deleteUpload,
  );

  assert.equal(result, response);
  assert.deepEqual(store.deletes, [
    "/uploads/diagnostics/request-owned.png",
  ]);
});

test("a database exception cleans uploads and preserves the primary exception", async () => {
  const commit = requiredExport("commitWithReportUploadCleanup");
  const path = "/uploads/diagnostics/request-owned.png";
  const store = createStore();
  const primary = new Error("database failed");

  await assert.rejects(
    commit(
      [path],
      async () => {
        throw primary;
      },
      undefined,
      store.deleteUpload,
    ),
    (error: unknown) => error === primary,
  );
  assert.deepEqual(store.deletes, [path]);
});

test("cleanup failure does not mask the primary database exception", async () => {
  const commit = requiredExport("commitWithReportUploadCleanup");
  const path = "/uploads/diagnostics/request-owned.png";
  const store = createStore({ failingDeletePath: path });
  const primary = new Error("database failed");

  await assert.rejects(
    commit(
      [path],
      async () => {
        throw primary;
      },
      undefined,
      store.deleteUpload,
    ),
    (error: unknown) => error === primary,
  );
  assert.deepEqual(store.deletes, [path]);
});

function adapterLifecycleIssues(
  source: string,
  options: { minimumCommits: number; preserveApiStatuses?: boolean },
): string[] {
  const issues: string[] = [];
  const collectionAt = source.indexOf("collectValidatedReportData(");
  const legacyCollectionAt = source.indexOf("collectReportData(");
  const commitPattern =
    /commitWithReportUploadCleanup\(\s*collected\.uploadedPaths\s*,/g;
  const commitMatches = source.match(commitPattern) ?? [];
  const firstCommitAt = source.search(commitPattern);
  if (collectionAt < 0) issues.push("validated collector missing");
  if (legacyCollectionAt >= 0) issues.push("legacy write-first collector remains");
  if (commitMatches.length < options.minimumCommits) {
    issues.push("compensating commit wrapper missing or receives wrong ledger");
  }
  if (collectionAt >= 0 && firstCommitAt >= 0 && firstCommitAt < collectionAt) {
    issues.push("commit wrapper precedes collection");
  }
  if (options.preserveApiStatuses) {
    const postCollection = collectionAt >= 0 ? source.slice(collectionAt) : source;
    if (!/jsonError\(\s*400\b/.test(postCollection)) {
      issues.push("API upload failure status 400 missing");
    }
    if (!/jsonError\(\s*422\b/.test(postCollection)) {
      issues.push("API report-validation status 422 missing");
    }
  }
  return issues;
}

test("adapter lifecycle guard detects collector, ledger, wrapper, order, and status mutants", () => {
  const valid = `
    const collected = await collectValidatedReportData(formData, schema);
    try { upload(); } catch { return jsonError(400, "upload"); }
    try { validate(); } catch { return jsonError(422, "report"); }
    return commitWithReportUploadCleanup(collected.uploadedPaths, commitOne);
    return commitWithReportUploadCleanup(collected.uploadedPaths, commitTwo);
  `;
  const options = { minimumCommits: 2, preserveApiStatuses: true };
  assert.deepEqual(adapterLifecycleIssues(valid, options), []);

  const missingOneBranch = valid.replace(
    "commitWithReportUploadCleanup(collected.uploadedPaths, commitTwo)",
    "commitWithoutCleanup(collected.uploadedPaths, commitTwo)",
  );
  assert.deepEqual(adapterLifecycleIssues(missingOneBranch, options), [
    "compensating commit wrapper missing or receives wrong ledger",
  ]);

  const wrongLedger = valid.replace(
    "commitWithReportUploadCleanup(collected.uploadedPaths, commitOne)",
    "commitWithReportUploadCleanup(existingPaths, commitOne)",
  );
  assert.deepEqual(adapterLifecycleIssues(wrongLedger, options), [
    "compensating commit wrapper missing or receives wrong ledger",
  ]);

  const missingValidation = valid.replace(
    "collectValidatedReportData",
    "collectReportData",
  );
  assert.deepEqual(adapterLifecycleIssues(missingValidation, options), [
    "validated collector missing",
    "legacy write-first collector remains",
  ]);

  const wrapperBeforeCollection = valid.replace(
    "const collected = await collectValidatedReportData(formData, schema);",
    "return commitWithReportUploadCleanup(collected.uploadedPaths, tooEarly);\n" +
      "const collected = await collectValidatedReportData(formData, schema);",
  );
  assert.deepEqual(adapterLifecycleIssues(wrapperBeforeCollection, options), [
    "commit wrapper precedes collection",
  ]);

  const missingUploadStatus = valid.replace(
    'return jsonError(400, "upload")',
    'return jsonError(422, "upload")',
  );
  assert.deepEqual(adapterLifecycleIssues(missingUploadStatus, options), [
    "API upload failure status 400 missing",
  ]);

  const missingValidationStatus = valid.replace(
    'return jsonError(422, "report")',
    'return jsonError(400, "report")',
  );
  assert.deepEqual(adapterLifecycleIssues(missingValidationStatus, options), [
    "API report-validation status 422 missing",
  ]);
});

test("API and dashboard adapters call the validated compensated lifecycle with its ledger", async () => {
  const [apiSource, actionSource] = await Promise.all([
    readFile(
      new URL(
        "../app/api/v1/diagnostics/reports/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/_actions/diagnostic-reports.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.deepEqual(
    // The route now funnels the item-linked, order-linked and standalone
    // paths through ONE commitDiagnosticReportCommand call (lib/diagnostic-report-commit.ts).
    adapterLifecycleIssues(apiSource, {
      minimumCommits: 1,
      preserveApiStatuses: true,
    }),
    [],
  );
  assert.deepEqual(
    adapterLifecycleIssues(actionSource, { minimumCommits: 1 }),
    [],
  );
});
