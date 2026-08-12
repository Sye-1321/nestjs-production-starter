import { Global, Module } from '@nestjs/common';

import { BodyParserErrorMiddleware } from './body-parser-error.middleware.js';
import { HttpErrorBoundary } from './http-error-boundary.js';
import { ProblemDetailsExceptionFilter } from './problem-details-exception.filter.js';
import { StrictValidationPipe } from './strict-validation.pipe.js';
import { TaskContentTypeMiddleware } from './task-content-type.middleware.js';

@Global()
@Module({
  providers: [
    HttpErrorBoundary,
    ProblemDetailsExceptionFilter,
    StrictValidationPipe,
    TaskContentTypeMiddleware,
    BodyParserErrorMiddleware,
  ],
  exports: [HttpErrorBoundary],
})
export class ErrorsModule {}
