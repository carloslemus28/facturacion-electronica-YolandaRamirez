const { DataTypes } = require('sequelize');
const { sequelize } = require('./database');

const isMissingTableError = (error) =>
  error?.original?.code === 'ER_NO_SUCH_TABLE' ||
  error?.parent?.code === 'ER_NO_SUCH_TABLE' ||
  error?.code === 'ER_NO_SUCH_TABLE';

const describeTableIfExists = async (queryInterface, tableName) => {
  try {
    return await queryInterface.describeTable(tableName);
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }
};

const ensureColumn = async ({ tableName, columnName, definition }) => {
  const queryInterface = sequelize.getQueryInterface();
  const table = await describeTableIfExists(queryInterface, tableName);

  if (!table || table[columnName]) {
    return false;
  }

  await queryInterface.addColumn(tableName, columnName, definition);
  return true;
};

const ensureRuntimeSchema = async () => {
  const changes = [];

  if (await ensureColumn({
    tableName: 'customers',
    columnName: 'secondary_email',
    definition: {
      type: DataTypes.STRING(160),
      allowNull: true
    }
  })) {
    changes.push('customers.secondary_email');
  }

  if (await ensureColumn({
    tableName: 'companies',
    columnName: 'use_logo_in_pdf',
    definition: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  })) {
    changes.push('companies.use_logo_in_pdf');
  }

  if (changes.length > 0) {
    console.log(`✅ Esquema actualizado: ${changes.join(', ')}`);
  }
};

module.exports = ensureRuntimeSchema;
