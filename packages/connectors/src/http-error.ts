export class HttpError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
  }
}
