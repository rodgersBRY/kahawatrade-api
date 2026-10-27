import { ApiError } from "./errors/ApiError.js";

type SortOrder = "asc" | "desc";

export type ListQueryParams = {
  page: number;
  pageSize: number;
  offset: number;
  sortBy: string;
  sortOrder: SortOrder;
  search?: string;
  filters: Record<string, string>;
};

type ListQueryOptions = {
  allowedSortBy: string[];
  defaultSortBy: string;
  defaultSortOrder?: SortOrder;
  maxPageSize?: number;
};

function pickFirst(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function parsePositiveInt(
  value: string | undefined,
  field: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, `${field} must be a positive integer`);
  }

  return parsed;
}

export function parseListQuery(
  rawQuery: Record<string, unknown>,
  options: ListQueryOptions,
): ListQueryParams {
  const maxPageSize = options.maxPageSize ?? 100;

  const page = parsePositiveInt(pickFirst(rawQuery.page), "page", 1);

  const pageSize = parsePositiveInt(
    pickFirst(rawQuery.page_size),
    "page_size",
    20,
  );

  if (pageSize > maxPageSize) {
    throw new ApiError(400, `page_size must be <= ${maxPageSize}`);
  }

  const sortByInput = pickFirst(rawQuery.sort_by) ?? options.defaultSortBy;
  if (!options.allowedSortBy.includes(sortByInput)) {
    throw new ApiError(
      400,
      `sort_by must be one of: ${options.allowedSortBy.join(", ")}`,
    );
  }

  const sortOrderInput = (
    pickFirst(rawQuery.sort_order) ??
    options.defaultSortOrder ??
    "desc"
  ).toLowerCase();
  if (sortOrderInput !== "asc" && sortOrderInput !== "desc") {
    throw new ApiError(400, "sort_order must be 'asc' or 'desc'");
  }

  const searchRaw = pickFirst(rawQuery.search)?.trim();

  const search = searchRaw ? searchRaw : undefined;

  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawQuery)) {
    if (!key.startsWith("filter_")) {
      continue;
    }

    const filterValue = pickFirst(value)?.trim();
    if (!filterValue) {
      continue;
    }

    filters[key.slice("filter_".length)] = filterValue;
  }

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    sortBy: sortByInput,
    sortOrder: sortOrderInput,
    search,
    filters,
  };
}

export function toIntFilter(
  filters: Record<string, string>,
  key: string,
): number | undefined {
  const value = filters[key];
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, `filter_${key} must be a positive integer`);
  }

  return parsed;
}

export function toUuidFilter(
  filters: Record<string, string>,
  key: string,
): string | undefined {
  const value = filters[key];
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) {
    throw new ApiError(400, `filter_${key} must be a valid UUID`);
  }
  return normalized;
}

export function toBooleanFilter(
  filters: Record<string, string>,
  key: string,
): boolean | undefined {
  const value = filters[key];
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new ApiError(400, `filter_${key} must be 'true' or 'false'`);
}

export function escapeLikeQuery(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  query: ListQueryParams,
): {
  data: T[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
    sort_by: string;
    sort_order: SortOrder;
    search?: string;
    filters: Record<string, string>;
  };
} {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  
  return {
    data,
    meta: {
      page: query.page,
      page_size: query.pageSize,
      total,
      total_pages: totalPages,
      has_next: query.page < totalPages,
      has_prev: query.page > 1,
      sort_by: query.sortBy,
      sort_order: query.sortOrder,
      search: query.search,
      filters: query.filters,
    },
  };
}
