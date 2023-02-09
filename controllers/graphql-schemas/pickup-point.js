const typeDefs = `
  type Query {
    id: ID
    name: String
  }
`;

const query = `{
  id
  name
}`;

module.exports = {
  typeDefs,
  query,
};
