const productsService = require('./products.service');

const listProducts = async (req, res, next) => {
  try {
    const products = await productsService.listProducts({
      query: req.query,
      user: req.user
    });

    res.set('Cache-Control', 'no-store');

    res.status(200).json({
      ok: true,
      products
    });
  } catch (error) {
    next(error);
  }
};


const exportProductsCsv = async (req, res, next) => {
  try {
    const filename = `productos-servicios-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    await productsService.exportProductsCsv({
      query: req.query,
      user: req.user,
      stream: res
    });

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    next(error);
  }
};

const getProductById = async (req, res, next) => {
  try {
    const product = await productsService.getProductById(req.params.id, {
      user: req.user
    });

    res.status(200).json({
      ok: true,
      product
    });
  } catch (error) {
    next(error);
  }
};

const createProduct = async (req, res, next) => {
  try {
    const product = await productsService.createProduct({
      data: req.body,
      user: req.user
    });

    res.status(201).json({
      ok: true,
      message: 'Producto o servicio registrado correctamente',
      product
    });
  } catch (error) {
    next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const product = await productsService.updateProduct(req.params.id, {
      data: req.body,
      user: req.user
    });

    res.status(200).json({
      ok: true,
      message: 'Producto o servicio actualizado correctamente',
      product
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listProducts,
  exportProductsCsv,
  getProductById,
  createProduct,
  updateProduct
};