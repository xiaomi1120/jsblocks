define([
  '../core',
  '../query/var/dataIdAttr',
  '../query/DomQuery',
  '../query/VirtualElement',
  '../mvc/Application',
  './parseToVirtual'
], function (blocks, dataIdAttr, DomQuery, VirtualElement, Application, parseToVirtual) {
  var eachQuery = blocks.queries.each.preprocess;

  blocks.queries.each.preprocess = function (domQuery, collection) {
    removeDataIds(this);
    server.data[this._attributes[dataIdAttr]] = this.renderChildren();
    eachQuery.call(this, domQuery, collection);
  };

  function removeDataIds(element) {
    var children = element._template || element._children;
    blocks.each(children, function (child) {
      if (VirtualElement.Is(child)) {
        child._attributes['data-id'] = null;
        removeDataIds(child);
      }
    });
  }

  blocks.query = function (model) {
    var domQuery = new DomQuery(model);
    var virtual = parseToVirtual(server.html);

    domQuery.pushContext(model);
    server.rendered = virtual.render(domQuery) + VirtualElement('script').html('window.__blocksServerData__ = ' + JSON.stringify(server.data)).render();
  };

  var executeExpressionValue = Expression.Execute;

  Expression.Execute = function (context, elementData, expressionData, entireExpression) {
    var value = executeExpressionValue(context, elementData, expressionData, entireExpression);
    elementData = value.elementData;
    if (elementData && !expressionData.attributeName) {
      server.data[elementData.id] = '{{' + elementData.expression + '}}';
    }

    return value;
  };

  Application.prototype._prepare = function () {
    server.applications.push(this);
  };

  //var createExpression =
});