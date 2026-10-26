import crypto from "node:crypto";

import {
  ListQueryParams,
  buildPaginatedResult,
  escapeLikeQuery,
} from "../../common/pagination.js";
import { ApiError } from "../../common/errors/ApiError.js";
import { withActor } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import {
  BulkImportConfig,
  BulkImportResult,
  buildImportTemplateCsv,
  runBulkImport,
} from "./master.bulkImport.js";
import {
  BagTypeInput,
  BuyerInput,
  GradeInput,
  SupplierInput,
  WarehouseInput,
  bagTypeSchema,
  buyerSchema,
  gradeSchema,
  supplierSchema,
  warehouseSchema,
} from "./master.validation.js";

const supplierImportConfig: BulkImportConfig<SupplierInput> = {
  entityLabel: "Supplier",
  table: "suppliers",
  columns: [
    {
      header: "name",
      field: "name",
      required: true,
      example: "Kilimanjaro Farmers Cooperative",
    },
    { header: "type", field: "type", required: false, example: "mill" },
    { header: "country", field: "country", required: false, example: "Kenya" },
  ],
  schema: supplierSchema,
  dedupeKey: (input) => input.name.trim().toLowerCase(),
  existingKeysQuery: `SELECT name AS key FROM suppliers WHERE organization_id = $1`,
  insertColumns: ["id", "name", "supplier_type", "country", "organization_id"],
  toInsertValues: (input, id, organizationId) => [
    id,
    input.name,
    input.type,
    input.country ?? null,
    organizationId,
  ],
};

const buyerImportConfig: BulkImportConfig<BuyerInput> = {
  entityLabel: "Buyer",
  table: "buyers",
  columns: [
    {
      header: "name",
      field: "name",
      required: true,
      example: "Blue Bottle Coffee",
    },
    {
      header: "country",
      field: "country",
      required: false,
      example: "United States",
    },
  ],
  schema: buyerSchema,
  dedupeKey: (input) => input.name.trim().toLowerCase(),
  existingKeysQuery: `SELECT name AS key FROM buyers WHERE organization_id = $1`,
  insertColumns: ["id", "name", "country", "organization_id"],
  toInsertValues: (input, id, organizationId) => [
    id,
    input.name,
    input.country ?? null,
    organizationId,
  ],
};

const warehouseImportConfig: BulkImportConfig<WarehouseInput> = {
  entityLabel: "Warehouse",
  table: "warehouses",
  columns: [
    {
      header: "name",
      field: "name",
      required: true,
      example: "Mombasa Central Warehouse",
    },
    {
      header: "location",
      field: "location",
      required: false,
      example: "Mombasa",
    },
  ],
  schema: warehouseSchema,
  dedupeKey: (input) => input.name.trim().toLowerCase(),
  existingKeysQuery: `SELECT name AS key FROM warehouses WHERE organization_id = $1`,
  insertColumns: ["id", "name", "location", "organization_id"],
  toInsertValues: (input, id, organizationId) => [
    id,
    input.name,
    input.location ?? null,
    organizationId,
  ],
};

const gradeImportConfig: BulkImportConfig<GradeInput> = {
  entityLabel: "Grade",
  table: "grades",
  columns: [
    { header: "code", field: "code", required: true, example: "AA" },
    {
      header: "description",
      field: "description",
      required: false,
      example: "Large bean, top grade",
    },
  ],
  schema: gradeSchema,
  dedupeKey: (input) => input.code.trim().toLowerCase(),
  existingKeysQuery: `SELECT code AS key FROM grades WHERE organization_id = $1`,
  insertColumns: ["id", "code", "description", "organization_id"],
  toInsertValues: (input, id, organizationId) => [
    id,
    input.code,
    input.description ?? null,
    organizationId,
  ],
};

const bagTypeImportConfig: BulkImportConfig<BagTypeInput> = {
  entityLabel: "Bag type",
  table: "bag_types",
  columns: [
    { header: "name", field: "name", required: true, example: "60kg Jute Bag" },
    {
      header: "weight_kg",
      field: "weight_kg",
      required: true,
      type: "number",
      example: "60",
    },
  ],
  schema: bagTypeSchema,
  dedupeKey: (input) => input.name.trim().toLowerCase(),
  existingKeysQuery: `SELECT name AS key FROM bag_types WHERE organization_id = $1`,
  insertColumns: ["id", "name", "weight_kg", "organization_id"],
  toInsertValues: (input, id, organizationId) => [
    id,
    input.name,
    input.weight_kg,
    organizationId,
  ],
};

type PgErrorLike = {
  code?: string;
};

function throwReferenceConflict(error: unknown, entityName: string): never {
  const pgError = error as PgErrorLike;
  if (pgError.code === "23503") {
    throw new ApiError(409, `${entityName} is in use and cannot be deleted`);
  }

  throw error;
}

export class MasterService {
  // SUPPLIER SERVICES
  async createSupplier(
    input: SupplierInput,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      INSERT INTO suppliers (id, name, supplier_type, country, organization_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
      [
        crypto.randomUUID(),
        input.name,
        input.type,
        input.country ?? null,
        actor.organizationId,
      ],
    );

    return result.rows[0];
  }

  async updateSupplier(
    id: string,
    input: Partial<SupplierInput>,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      UPDATE suppliers
      SET name = $1, supplier_type = $2, country = $3
      WHERE id = $4 AND organization_id = $5
      RETURNING *;
      `,
      [input.name, input.type, input.country ?? null, id, actor.organizationId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, `Supplier not found`);
    }
    return result.rows[0];
  }

  async deleteSupplier(id: string, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `DELETE FROM suppliers WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, actor.organizationId],
    ).catch((error: unknown) => throwReferenceConflict(error, "Supplier"));

    if (result.rowCount === 0) {
      throw new ApiError(404, `Supplier not found`);
    }
    return result.rows[0];
  }

  async listSuppliers(
    listQuery: ListQueryParams,
    actor: AuthContext,
  ): Promise<unknown> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    values.push(actor.organizationId);
    whereClauses.push(`organization_id = $${values.length}`);

    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(`name ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (listQuery.filters.type) {
      values.push(listQuery.filters.type);
      whereClauses.push(`supplier_type = $${values.length}`);
    }
    if (listQuery.filters.country) {
      values.push(listQuery.filters.country);
      whereClauses.push(`country = $${values.length}`);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM suppliers ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT * FROM suppliers
      ${whereSql}
      ORDER BY ${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(
      result.rows,
      Number(countResult.rows[0].total),
      listQuery,
    );
  }

  // BUYER SERVICES
  async createBuyer(input: BuyerInput, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      INSERT INTO buyers (id, name, country, organization_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [
        crypto.randomUUID(),
        input.name,
        input.country ?? null,
        actor.organizationId,
      ],
    );
    return result.rows[0];
  }

  async updateBuyer(
    id: string,
    input: Partial<BuyerInput>,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      UPDATE buyers SET name = $1, country = $2 WHERE id = $3 AND organization_id = $4 RETURNING *;
      `,
      [input.name, input.country ?? null, id, actor.organizationId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, `Buyer not found`);
    }
    return result.rows[0];
  }

  async deleteBuyer(id: string, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `DELETE FROM buyers WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, actor.organizationId],
    ).catch((error: unknown) => throwReferenceConflict(error, "Buyer"));

    if (result.rowCount === 0) {
      throw new ApiError(404, `Buyer not found`);
    }
    return result.rows[0];
  }

  async listBuyers(
    listQuery: ListQueryParams,
    actor: AuthContext,
  ): Promise<unknown> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    values.push(actor.organizationId);
    whereClauses.push(`organization_id = $${values.length}`);

    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(`name ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (listQuery.filters.country) {
      values.push(listQuery.filters.country);
      whereClauses.push(`country = $${values.length}`);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM buyers ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT * FROM buyers
      ${whereSql}
      ORDER BY ${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(
      result.rows,
      Number(countResult.rows[0].total),
      listQuery,
    );
  }

  // WAREHOUSE SERVICES
  async createWarehouse(
    input: WarehouseInput,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      INSERT INTO warehouses (id, name, location, organization_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [
        crypto.randomUUID(),
        input.name,
        input.location ?? null,
        actor.organizationId,
      ],
    );
    return result.rows[0];
  }

  async updateWarehouse(
    id: string,
    input: Partial<WarehouseInput>,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      UPDATE warehouses SET name = $1, location = $2 WHERE id = $3 AND organization_id = $4 RETURNING *;
      `,
      [input.name, input.location ?? null, id, actor.organizationId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, `Warehouse not found`);
    }
    return result.rows[0];
  }

  async deleteWarehouse(id: string, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `DELETE FROM warehouses WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, actor.organizationId],
    ).catch((error: unknown) => throwReferenceConflict(error, "Warehouse"));

    if (result.rowCount === 0) {
      throw new ApiError(404, `Warehouse not found`);
    }
    return result.rows[0];
  }

  async listWarehouses(
    listQuery: ListQueryParams,
    actor: AuthContext,
  ): Promise<unknown> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    values.push(actor.organizationId);
    whereClauses.push(`organization_id = $${values.length}`);

    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(`name ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (listQuery.filters.location) {
      values.push(listQuery.filters.location);
      whereClauses.push(`location = $${values.length}`);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM warehouses ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT * FROM warehouses
      ${whereSql}
      ORDER BY ${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(
      result.rows,
      Number(countResult.rows[0].total),
      listQuery,
    );
  }

  // GRADE SERVICES
  async createGrade(input: GradeInput, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      INSERT INTO grades (id, code, description, organization_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [
        crypto.randomUUID(),
        input.code,
        input.description ?? null,
        actor.organizationId,
      ],
    );
    return result.rows[0];
  }

  async updateGrade(
    id: string,
    input: Partial<GradeInput>,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      UPDATE grades SET code = $1, description = $2 WHERE id = $3 AND organization_id = $4 RETURNING *;
      `,
      [input.code, input.description ?? null, id, actor.organizationId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, `Grade not found`);
    }
    return result.rows[0];
  }

  async deleteGrade(id: string, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `DELETE FROM grades WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, actor.organizationId],
    ).catch((error: unknown) => throwReferenceConflict(error, "Grade"));

    if (result.rowCount === 0) {
      throw new ApiError(404, `Grade not found`);
    }
    return result.rows[0];
  }

  async listGrades(
    listQuery: ListQueryParams,
    actor: AuthContext,
  ): Promise<unknown> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    values.push(actor.organizationId);
    whereClauses.push(`organization_id = $${values.length}`);

    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(
        `(code ILIKE $${values.length} ESCAPE '\\' OR description ILIKE $${values.length} ESCAPE '\\')`,
      );
    }
    if (listQuery.filters.code) {
      values.push(listQuery.filters.code);
      whereClauses.push(`code = $${values.length}`);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM grades ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT * FROM grades
      ${whereSql}
      ORDER BY ${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(
      result.rows,
      Number(countResult.rows[0].total),
      listQuery,
    );
  }

  // BAG TYPE SERVICES
  async createBagType(
    input: BagTypeInput,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      INSERT INTO bag_types (id, name, weight_kg, organization_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [crypto.randomUUID(), input.name, input.weight_kg, actor.organizationId],
    );
    return result.rows[0];
  }

  async updateBagType(
    id: string,
    input: Partial<BagTypeInput>,
    actor: AuthContext,
  ): Promise<unknown> {
    const result = await withActor(
      actor,
      `
      UPDATE bag_types SET name = $1, weight_kg = $2 WHERE id = $3 AND organization_id = $4 RETURNING *;
      `,
      [input.name, input.weight_kg ?? null, id, actor.organizationId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, `Bag type not found`);
    }
    return result.rows[0];
  }

  async deleteBagType(id: string, actor: AuthContext): Promise<unknown> {
    const result = await withActor(
      actor,
      `DELETE FROM bag_types WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, actor.organizationId],
    ).catch((error: unknown) => throwReferenceConflict(error, "Bag type"));

    if (result.rowCount === 0) {
      throw new ApiError(404, `Bag type not found`);
    }
    return result.rows[0];
  }

  async listBagTypes(
    listQuery: ListQueryParams,
    actor: AuthContext,
  ): Promise<unknown> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    values.push(actor.organizationId);
    whereClauses.push(`organization_id = $${values.length}`);

    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(`name ILIKE $${values.length} ESCAPE '\\'`);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM bag_types ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT * FROM bag_types
      ${whereSql}
      ORDER BY ${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(
      result.rows,
      Number(countResult.rows[0].total),
      listQuery,
    );
  }

  // BULK IMPORT SERVICES
  async importSuppliers(
    fileBuffer: Buffer,
    filename: string,
    actor: AuthContext,
  ): Promise<BulkImportResult> {
    return runBulkImport(supplierImportConfig, fileBuffer, filename, actor);
  }

  getSuppliersImportTemplate(): string {
    return buildImportTemplateCsv(supplierImportConfig.columns);
  }

  async importBuyers(
    fileBuffer: Buffer,
    filename: string,
    actor: AuthContext,
  ): Promise<BulkImportResult> {
    return runBulkImport(buyerImportConfig, fileBuffer, filename, actor);
  }

  getBuyersImportTemplate(): string {
    return buildImportTemplateCsv(buyerImportConfig.columns);
  }

  async importWarehouses(
    fileBuffer: Buffer,
    filename: string,
    actor: AuthContext,
  ): Promise<BulkImportResult> {
    return runBulkImport(warehouseImportConfig, fileBuffer, filename, actor);
  }

  getWarehousesImportTemplate(): string {
    return buildImportTemplateCsv(warehouseImportConfig.columns);
  }

  async importGrades(
    fileBuffer: Buffer,
    filename: string,
    actor: AuthContext,
  ): Promise<BulkImportResult> {
    return runBulkImport(gradeImportConfig, fileBuffer, filename, actor);
  }

  getGradesImportTemplate(): string {
    return buildImportTemplateCsv(gradeImportConfig.columns);
  }

  async importBagTypes(
    fileBuffer: Buffer,
    filename: string,
    actor: AuthContext,
  ): Promise<BulkImportResult> {
    return runBulkImport(bagTypeImportConfig, fileBuffer, filename, actor);
  }

  getBagTypesImportTemplate(): string {
    return buildImportTemplateCsv(bagTypeImportConfig.columns);
  }
}

export const masterService = new MasterService();
