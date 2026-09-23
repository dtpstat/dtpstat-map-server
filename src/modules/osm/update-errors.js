export class OsmCityGeometryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OsmCityGeometryError';
  }
}
