import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Logs one line per request: method, route pattern, status, duration and the caller's user id.
 * Bodies, query strings and headers are deliberately not logged, so passwords, tokens and
 * merchant PII cannot reach the logs through this path.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: { id: string } }>();
    const started = Date.now();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;

    const log = (statusCode: number) =>
      this.logger.log({
        method: req.method,
        route,
        statusCode,
        durationMs: Date.now() - started,
        userId: req.user?.id,
      });

    return next.handle().pipe(
      tap({
        next: () => log(http.getResponse<Response>().statusCode),
        error: (err: { getStatus?: () => number }) => log(err.getStatus?.() ?? 500),
      }),
    );
  }
}
