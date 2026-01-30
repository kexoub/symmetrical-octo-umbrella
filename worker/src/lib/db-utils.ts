import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { createLogger } from './api-utils';

const logger = createLogger('DBUtils');

// 数据库查询构建器
export class QueryBuilder {
  private table: string;
  private conditions: string[] = [];
  private params: unknown[] = [];
  private orderByClause: string = '';
  private limitClause: string = '';
  private offsetClause: string = '';
  private selectFields: string = '*';

  constructor(table: string) {
    this.table = table;
  }

  select(fields: string | string[]): QueryBuilder {
    this.selectFields = Array.isArray(fields) ? fields.join(', ') : fields;
    return this;
  }

  where(condition: string, ...values: unknown[]): QueryBuilder {
    this.conditions.push(condition);
    this.params.push(...values);
    return this;
  }

  whereIn(field: string, values: unknown[]): QueryBuilder {
    if (values.length === 0) return this;
    const placeholders = values.map(() => '?').join(', ');
    this.conditions.push(`${field} IN (${placeholders})`);
    this.params.push(...values);
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder {
    this.orderByClause = `ORDER BY ${field} ${direction}`;
    return this;
  }

  limit(count: number): QueryBuilder {
    this.limitClause = `LIMIT ${count}`;
    return this;
  }

  offset(count: number): QueryBuilder {
    this.offsetClause = `OFFSET ${count}`;
    return this;
  }

  build(): { sql: string; params: unknown[] } {
    let sql = `SELECT ${this.selectFields} FROM ${this.table}`;
    
    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(' AND ')}`;
    }
    
    if (this.orderByClause) {
      sql += ` ${this.orderByClause}`;
    }
    
    if (this.limitClause) {
      sql += ` ${this.limitClause}`;
    }
    
    if (this.offsetClause) {
      sql += ` ${this.offsetClause}`;
    }

    return { sql, params: this.params };
  }
}

// 批量操作构建器
export class BatchBuilder {
  private statements: D1PreparedStatement[] = [];

  add(statement: D1PreparedStatement): BatchBuilder {
    this.statements.push(statement);
    return this;
  }

  addAll(statements: D1PreparedStatement[]): BatchBuilder {
    this.statements.push(...statements);
    return this;
  }

  isEmpty(): boolean {
    return this.statements.length === 0;
  }

  getStatements(): D1PreparedStatement[] {
    return this.statements;
  }

  clear(): void {
    this.statements = [];
  }
}

// 分页查询结果
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// 分页查询辅助函数
export async function paginateQuery<T>(
  db: D1Database,
  baseQuery: string,
  countQuery: string,
  params: unknown[],
  page: number,
  limit: number
): Promise<PaginatedResult<T>> {
  const offset = (page - 1) * limit;
  
  try {
    // 并行执行数据查询和计数查询
    const [dataResult, countResult] = await Promise.all([
      db.prepare(`${baseQuery} LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<T>(),
      db.prepare(countQuery).bind(...params).first<{ count: number }>(),
    ]);

    const total = countResult?.count || 0;
    const data = dataResult.results || [];

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + data.length < total,
      },
    };
  } catch (error) {
    logger.error('Pagination query failed', error, { baseQuery, page, limit });
    throw error;
  }
}

// 事务执行辅助函数
export async function executeTransaction(
  db: D1Database,
  statements: D1PreparedStatement[]
): Promise<void> {
  if (statements.length === 0) return;
  
  try {
    await db.batch(statements);
    logger.debug('Transaction executed successfully', { statementCount: statements.length });
  } catch (error) {
    logger.error('Transaction failed', error, { statementCount: statements.length });
    throw error;
  }
}

// 安全的批量删除（带统计更新）
export async function safeBatchDelete(
  db: D1Database,
  table: string,
  ids: number[],
  options?: {
    relatedStats?: {
      table: string;
      field: string;
      decrementField: string;
      groupByField: string;
    }[];
  }
): Promise<{ deletedCount: number }> {
  if (ids.length === 0) return { deletedCount: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const statements: D1PreparedStatement[] = [];

  // 如果需要更新相关统计
  if (options?.relatedStats && options.relatedStats.length > 0) {
    for (const stat of options.relatedStats) {
      const statsQuery = `
        SELECT ${stat.groupByField} as group_id, COUNT(*) as count, SUM(${stat.decrementField}) as total
        FROM ${table}
        WHERE id IN (${placeholders})
        GROUP BY ${stat.groupByField}
      `;
      
      const { results } = await db.prepare(statsQuery).bind(...ids).all<{
        group_id: number;
        count: number;
        total: number;
      }>();

      for (const row of results || []) {
        statements.push(
          db.prepare(
            `UPDATE ${stat.table} SET ${stat.field} = ${stat.field} - ?, ${stat.decrementField} = ${stat.decrementField} - ? WHERE id = ?`
          ).bind(row.count, row.total, row.group_id)
        );
      }
    }
  }

  // 执行删除
  statements.push(db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).bind(...ids));

  await executeTransaction(db, statements);
  
  return { deletedCount: ids.length };
}

// 统计更新构建器
export class StatsUpdater {
  private updates = new Map<number, { increment: number; decrement: number }>();

  add(nodeId: number, increment = 0, decrement = 0): void {
    const current = this.updates.get(nodeId) || { increment: 0, decrement: 0 };
    this.updates.set(nodeId, {
      increment: current.increment + increment,
      decrement: current.decrement + decrement,
    });
  }

  buildStatements(db: D1Database, table: string, countField: string): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];
    
    for (const [nodeId, stats] of this.updates.entries()) {
      const netChange = stats.increment - stats.decrement;
      if (netChange !== 0) {
        statements.push(
          db.prepare(`UPDATE ${table} SET ${countField} = ${countField} + ? WHERE id = ?`).bind(netChange, nodeId)
        );
      }
    }
    
    return statements;
  }

  isEmpty(): boolean {
    return this.updates.size === 0;
  }
}
