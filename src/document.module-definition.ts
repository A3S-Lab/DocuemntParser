import { ConfigurableModuleBuilder } from '@nestjs/common';
import { DocumentModuleOptions } from './document-module-options.interface';

export const {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: DOCUMENT_MODULE_OPTIONS,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<DocumentModuleOptions>()
  .setExtras(
    { isGlobal: false },
    (definition, extras) => ({
      ...definition,
      global: extras.isGlobal,
    }),
  )
  .build();
