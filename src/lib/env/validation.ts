export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export class EnvironmentConfigurationError extends Error {
  constructor(message: string) {
    super(`Environment configuration error: ${message}`);
    this.name = "EnvironmentConfigurationError";
  }
}

export function requiredString(
  source: EnvironmentSource,
  name: string,
  options: { minLength?: number } = {},
) {
  const value = source[name]?.trim();
  if (!value) {
    throw new EnvironmentConfigurationError(`${name} is required.`);
  }
  if (value.length < (options.minLength ?? 1)) {
    throw new EnvironmentConfigurationError(
      `${name} must contain at least ${options.minLength} characters.`,
    );
  }
  return value;
}

export function optionalString(source: EnvironmentSource, name: string) {
  return source[name]?.trim() || undefined;
}

export function requiredUrl(source: EnvironmentSource, name: string) {
  const value = requiredString(source, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnvironmentConfigurationError(`${name} must be a valid URL.`);
  }
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new EnvironmentConfigurationError(
      `${name} must use HTTPS unless it points to localhost.`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function optionalUrl(source: EnvironmentSource, name: string) {
  return optionalString(source, name) ? requiredUrl(source, name) : undefined;
}
