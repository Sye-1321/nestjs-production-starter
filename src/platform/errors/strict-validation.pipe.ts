import { Injectable, ValidationPipe } from '@nestjs/common';

export class RequestValidationError extends Error {
  public constructor() {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}

@Injectable()
export class StrictValidationPipe extends ValidationPipe {
  public constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: false,
      transformOptions: { enableImplicitConversion: false },
      validationError: {
        target: false,
        value: false,
      },
      exceptionFactory: () => new RequestValidationError(),
    });
  }
}
