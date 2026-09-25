/**
 * The generated SDK's non-throwing result shape.
 *
 * Defined locally so the hand-written helpers never import generated code.
 */
export type SdkResult<TData = unknown, TError = unknown> =
  | {
      data: TData;
      error: undefined;
      request: Request;
      response: Response;
    }
  | {
      data: undefined;
      error: TError;
      request: Request;
      response: Response | undefined;
    };

type ErrorStatus<TErrorMap> = Extract<keyof TErrorMap, number>;

/** An API error whose status and body were declared by the operation. */
export type DocumentedSentryApiError<TErrorMap> = {
  [TStatus in ErrorStatus<TErrorMap>]: SentryApiError<
    TStatus,
    TErrorMap[TStatus],
    true
  >;
}[ErrorStatus<TErrorMap>];

/** An API error returned under a status absent from the operation's schema. */
export type UndocumentedSentryApiError = SentryApiError<
  number,
  unknown,
  false
>;

/** A request failure that happened before an HTTP response arrived. */
export type SentryApiTransportError = SentryApiError<
  undefined,
  unknown,
  false
>;

export type SentryApiResultError<TErrorMap> =
  | DocumentedSentryApiError<TErrorMap>
  | UndocumentedSentryApiError
  | SentryApiTransportError;

export type NarrowedResult<TData, TErrorMap> =
  | { ok: true; data: TData; response: Response }
  | { ok: false; error: SentryApiResultError<TErrorMap> };

/** An API failure with its parsed body and raw response. */
export class SentryApiError<
  TStatus extends number | undefined = number | undefined,
  TBody = unknown,
  TDocumented extends boolean = boolean,
> extends Error {
  readonly status: TStatus;
  readonly body: TBody;
  readonly response: Response | undefined;
  readonly documented: TDocumented;

  constructor(
    status: TStatus,
    body: TBody,
    response: Response | undefined,
    documented: TDocumented,
    message = status === undefined
      ? "Sentry API request failed before receiving a response"
      : `Sentry API request failed with status ${status}`,
  ) {
    super(message);
    this.name = "SentryApiError";
    this.status = status;
    this.body = body;
    this.response = response;
    this.documented = documented;
  }
}

/**
 * Convert an SDK result to a status-discriminated result.
 *
 * Prefer the generated `narrowError_<operation>` wrappers. They supply the
 * operation's complete error map and documented statuses automatically.
 */
export const narrowError = <TData, TErrorMap>(
  result: SdkResult<TData, TErrorMap[ErrorStatus<TErrorMap>]>,
  documentedStatuses: ReadonlyArray<ErrorStatus<TErrorMap>>,
): NarrowedResult<TData, TErrorMap> => {
  if (result.error === undefined) {
    return {
      ok: true,
      data: result.data as TData,
      response: result.response as Response,
    };
  }

  const status = result.response?.status;
  if (status === undefined) {
    return {
      ok: false,
      error: new SentryApiError(
        undefined,
        result.error,
        undefined,
        false,
      ),
    };
  }

  const documented = documentedStatuses.includes(
    status as ErrorStatus<TErrorMap>,
  );
  const error = new SentryApiError(
    status,
    result.error,
    result.response,
    documented,
  );

  // OpenAPI binds each documented response status to its body schema. The
  // generated SDK flattens that map, so restore the relationship here.
  return {
    ok: false,
    error: error as SentryApiResultError<TErrorMap>,
  };
};

/**
 * Call an SDK operation and convert HTTP and transport failures to one result.
 * Generated operation wrappers use this helper.
 */
export const callWithTypedErrors = async <TData, TErrorMap>(
  call: () => Promise<SdkResult<TData, TErrorMap[ErrorStatus<TErrorMap>]>>,
  documentedStatuses: ReadonlyArray<ErrorStatus<TErrorMap>>,
): Promise<NarrowedResult<TData, TErrorMap>> => {
  try {
    return narrowError(await call(), documentedStatuses);
  } catch (error) {
    return {
      ok: false,
      error: new SentryApiError(undefined, error, undefined, false),
    };
  }
};
