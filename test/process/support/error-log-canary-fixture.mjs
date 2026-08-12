import { RequestContextStorage } from '../../../dist/platform/context/request-context.js';
import { HttpErrorBoundary } from '../../../dist/platform/errors/http-error-boundary.js';
import { ApplicationLogger } from '../../../dist/platform/logging/application-logger.js';

const ERROR_MESSAGE_CANARY = 'M2C5_ERROR_MESSAGE_CANARY_18C2';
const ERROR_CAUSE_CANARY = 'M2C5_ERROR_CAUSE_CANARY_572A';
const NESTED_METADATA_CANARY = 'M2C5_NESTED_METADATA_CANARY_93F1';
const ARBITRARY_PROPERTY_CANARY = 'M2C5_ARBITRARY_PROPERTY_CANARY_D04B';
const REQUEST_ID = 'm2c5-error-log-request';

const storage = new RequestContextStorage();
const logger = new ApplicationLogger('info');
const boundary = new HttpErrorBoundary(storage, logger);
const error = new Error(ERROR_MESSAGE_CANARY, {
  cause: new Error(ERROR_CAUSE_CANARY),
});
error.metadata = { nested: NESTED_METADATA_CANARY };
error.arbitrary = ARBITRARY_PROPERTY_CANARY;

const request = {
  method: 'PATCH',
  route: { path: '/v1/tasks/:id' },
};
const response = {
  statusCode: 200,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  setHeader() {
    return this;
  },
  json() {
    return this;
  },
};

storage.run({ requestId: REQUEST_ID, abortSignal: {} }, () => {
  boundary.unexpected(error, request, response);
});
