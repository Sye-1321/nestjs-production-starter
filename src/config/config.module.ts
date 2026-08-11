import { Module, type DynamicModule } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from './config.types.js';

@Module({})
export class ConfigModule {
  public static forRoot(config: AppConfig): DynamicModule {
    const immutableConfig = Object.freeze({ ...config });

    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: immutableConfig }],
      exports: [APP_CONFIG],
    };
  }
}
