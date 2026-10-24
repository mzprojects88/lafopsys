// The little of `pg` the database sync route uses (0104); the scripts under scripts/ use it untyped.
declare module "pg" {
  export interface QueryResult<R = Record<string, unknown>> {
    rows: R[];
    rowCount: number | null;
  }
  export class Client {
    constructor(config: { connectionString: string; ssl?: { rejectUnauthorized: boolean } });
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
}
