const fs = require('fs');
const { pipeline } = require('stream/promises');

const tourplanIntegration = async (plugins, req) => {
  const { app, userId, hint } = req.params;
  if (app !== 'tourplannx') {
    const error = new Error('Only TourPlan NX is supported');
    error.status = 400;
    throw error;
  }
  const plugin = plugins.find(item => item.name === 'tourplannx');
  const { UserAppKey } = require('../models');
  const integration = await UserAppKey.findOne({
    where: { userId, integrationId: 'tourplannx', hint },
  });
  if (!integration) {
    const error = new Error('Integration not found');
    error.status = 404;
    throw error;
  }
  return { plugin, credential: integration, userId, hint };
};

const getProductFilesArchive = plugins => async (req, res, next) => {
  let result;
  try {
    const { selection, usage, usageHash } = req.body || {};
    const usageIds = usage && typeof usage === 'object' && !Array.isArray(usage)
      ? Object.keys(usage) : [];
    if (!['all', 'usage'].includes(selection)
      || (selection === 'usage' && (!usage || typeof usage !== 'object'
        || Array.isArray(usage) || !usageIds.length
        || usageIds.some(id => !id.trim())
        || new Set(usageIds.map(id => id.trim())).size !== usageIds.length))
      || (selection === 'all' && usage !== undefined)
      || (usageHash !== undefined && !/^[a-f0-9]{64}$/.test(usageHash))) {
      return res.status(400).json({ error: 'Choose all, or usage with a nonempty usage map' });
    }
    const scope = await tourplanIntegration(plugins, req);
    if (!scope.plugin || typeof scope.plugin.createProductFilesArchive !== 'function') {
      throw new Error('TourPlan NX product files exporter is unavailable');
    }
    result = await scope.plugin.createProductFilesArchive({
      token: await scope.credential.token,
      userId: scope.userId,
      hint: scope.hint,
      selection, usage, usageHash,
    });
    if (result.status === 'no_matching_options') return res.json(result);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="product-files.tar.gz"');
    await pipeline(fs.createReadStream(result.archivePath), res);
    return undefined;
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return next(error);
  } finally {
    if (result && result.cleanup) {
      try {
        await result.cleanup();
      } catch (cleanupError) {
        console.error('Failed to clean up TourPlan product files archive', cleanupError);
      }
    }
  }
};

const getProductFilesVersion = plugins => async (req, res, next) => {
  try {
    const integration = await tourplanIntegration(plugins, req);
    if (!integration.plugin || typeof integration.plugin.getProductFilesProjectionVersion !== 'function') {
      throw new Error('TourPlan NX product files exporter is unavailable');
    }
    const projectionVersion = await integration.plugin.getProductFilesProjectionVersion();
    return res.json({ projectionVersion });
  } catch (error) {
    return next(error);
  }
};

module.exports = plugins => ({
  getProductFilesArchive: getProductFilesArchive(plugins),
  getProductFilesVersion: getProductFilesVersion(plugins),
});
