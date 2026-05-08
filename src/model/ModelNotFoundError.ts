export class ModelNotFoundError extends Error {
  modelName: string;
  identifiers?: any;

  constructor(modelName: string, identifiers?: any) {
    const msg = identifiers !== undefined
      ? `No query results for model [${modelName}] ${JSON.stringify(identifiers)}`
      : `No query results for model [${modelName}]`;
    super(msg);
    this.name = "ModelNotFoundError";
    this.modelName = modelName;
    this.identifiers = identifiers;
  }
}
