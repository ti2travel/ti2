module.exports = {
  up: async queryInterface => {
    const payload = {
      name: 'tourconnect',
      packageName: 'ti2-tourconnect',
      adminEmail: 'ti2@tourconnect.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await queryInterface.bulkInsert('Integrations', [payload]);
  },
  down: async queryInterface => {
    await queryInterface.bulkDelete('Integrations', [{
      name: 'tourconnect',
    }]);
  },
};
