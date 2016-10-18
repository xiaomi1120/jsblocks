define([
  '../core',
  '../modules/Events',
  './Observer'
], function (blocks, Events, Observer) {
  
  var Action = {
    NOOP: 0,
    ADD: 1,
    REMOVE: 2,
    EXISTS: 3
  };

  var ExtenderHelper = {
    waiting: {},
    operations: {
      FILTER: 1,
      STEP:   2,
      SKIP:   3,
      TAKE:   4,
      SORT:   5
    },

    initExpressionExtender: function (observable) {
      var newObservable = observable.clone();

      newObservable.view = blocks.observable([]);
      newObservable.view._connections = {};
      newObservable.view._observed = [];
      newObservable.view._updateObservable = blocks.bind(ExtenderHelper.updateObservable, newObservable);
      newObservable._operations = observable._operations ? blocks.clone(observable._operations) : [];
      newObservable._getter = blocks.bind(ExtenderHelper.getter, newObservable);
      newObservable.view._initialized = false;

      newObservable.view.on('get', newObservable._getter);
      
      newObservable.on('add', function () {
        if (newObservable.view._initialized) {
          newObservable.view._connections = {};
          newObservable.view.reset();
          ExtenderHelper.executeOperations(newObservable);
        }
      });
  
      newObservable.on('remove', function () {
        if (newObservable.view._initialized) {
          newObservable.view._connections = {};
          newObservable.view.reset();
          ExtenderHelper.executeOperations(newObservable);
        }
      });

      return newObservable;
    },

    getter: function () {
      Events.off(this.view, 'get', this._getter);
      this._getter = undefined;
      this.view._initialized = true;
      ExtenderHelper.executeOperationsPure(this);
    },

    updateObservable: function () {
      ExtenderHelper.executeOperations(this);
    },

    executeOperationsPure: function (observable) {
      var chunk = [];
      var observed = observable.view._observed;
      var updateObservable = observable.view._updateObservable;

      blocks.each(observed, function (observable) {
        Events.off(observable, 'change', updateObservable);
      });
      observed = observable.view._observed = [];
      Observer.startObserving();

      blocks.each(observable._operations, function (operation) {
        if (operation.type == ExtenderHelper.operations.STEP) {
          var view = observable.view;
          observable.view = blocks.observable([]);
          observable.view._connections = {};
          if (chunk.length) {
            ExtenderHelper.executeOperationsChunk(observable, chunk);
          }
          operation.step.call(observable.__context__);
          observable.view = view;
        } else {
          chunk.push(operation);
        }
      });

      if (chunk.length) {
        ExtenderHelper.executeOperationsChunk(observable, chunk);
      }

      blocks.each(Observer.stopObserving(), function (observable) {
        observed.push(observable);
        observable.on('change', updateObservable);
      });
    },

    executeOperations: function (observable) {
      var id = observable.__id__;
      var waiting = ExtenderHelper.waiting;

      if (!waiting[id]) {
        waiting[id] = true;
        setTimeout(function () {
          ExtenderHelper.executeOperationsPure(observable);
          waiting[id] = false;
        }, 0);
      }
    },

    executeOperationsChunk: function (observable, operations) {
      var action = Action.EXISTS;

      var collection = observable.__value__;
      var view = observable.view;
      var connections = view._connections;
      var newConnections = {};
      var viewIndex = 0;
      var update = view.update;
      var skip = 0;
      var take = collection.length;
      view.update = blocks.noop;

      blocks.each(operations, function prepareOperations(operation) {
        switch (operation.type) {
          case ExtenderHelper.operations.SKIP:
            skip = operation.skip;
            if (blocks.isFunction(skip)) {
              skip = skip.call(observable.__context__);
            }
            skip = blocks.unwrap(skip);
            break;
          case ExtenderHelper.operations.TAKE:
            take = operation.take;
            if (blocks.isFunction(take)) {
              take = take.call(observable.__context__);
            }
            take = blocks.unwrap(take);
            break;
          case ExtenderHelper.operations.SORT:
            // @todo resort connections after sorting this
            if (blocks.isString(operation.sort)) {
              collection = blocks.clone(collection).sort(function (valueA, valueB) {
                valueA = blocks.unwrap(valueA[operation.sort]);
                valueB = blocks.unwrap(valueB[operation.sort]);
                if (valueA > valueB) {
                  return 1;
                }
                if (valueA < valueB) {
                  return -1;
                }
                return 0;
              });
            } else if (blocks.isFunction(operation.sort)) {
              collection = blocks.clone(collection).sort(operation.sort.bind(observable.__context__));
            } else {
              collection = blocks.clone(collection).sort();
            }
            if (operations.length == 1) {
              operations.push({ type: ExtenderHelper.operations.FILTER, filter: function () { return true; }});
            }
            break;
        }
      });

      blocks.each(collection, function iterateCollection(value, index) {
        var oldIndex;
        if (take <= 0) {
          while (view().length - viewIndex > 0) {
            view.removeAt(view().length - 1);
            view._connections = {};
          }
          return false;
        }

        blocks.each(operations, function executeExtender(operation) {
          var filterCallback = operation.filter;
          operation.type = operation.type || (filterCallback && ExtenderHelper.operations.FILTER);

          action = Action.NOOP;

          switch (operation.type) {
            case ExtenderHelper.operations.FILTER:
              if (filterCallback.call(observable.__context__, value, index, collection)) {
                action = Action.EXISTS;

                if (connections[index] === undefined) {
                  action = Action.ADD;
                }
              } else {
                action = Action.NOOP;
                if (connections[index] !== undefined) {
                  action = Action.REMOVE;
                }
                return false;
              }
              break;

            case ExtenderHelper.operations.SKIP:
              action = Action.EXISTS;
              skip -= 1;
              if (skip >= 0) {
                action = Action.REMOVE;
                return false;
              } else if (skip < 0 && connections[index] === undefined) {
                action = Action.ADD;
              }
              break;

            case ExtenderHelper.operations.TAKE:
              if (take <= 0) {
                action = Action.REMOVE;
                return false;
              } else {
                take -= 1;
                action = Action.EXISTS;

                if (connections[index] === undefined) {
                  action = Action.ADD;
                }
              }
              break;
          }
        });

        oldIndex = connections[index];
        switch (action) {
          case Action.ADD:
            newConnections[index] = viewIndex;
            view.splice(viewIndex, 0, value);
            blocks.each(connections, function (valueViewIndex, i) {
              if (valueViewIndex >=  viewIndex) {
                connections[i] = ++valueViewIndex;
              }
            });
            viewIndex++;
            break;
          case Action.REMOVE:
            view.removeAt(oldIndex);
            blocks.each(connections, function (valueViewIndex,i ) {
              if (valueViewIndex > oldIndex) {
                connections[i] = --valueViewIndex;
              }
            });
            break;
          case Action.EXISTS:
            newConnections[index] = viewIndex;
            if (oldIndex != viewIndex) {
              view.move(oldIndex, viewIndex);
              blocks.each(connections, function (valueViewIndex, i) {
                if (valueViewIndex > oldIndex) {
                  valueViewIndex--;
                } else if (valueViewIndex > viewIndex) {
                  valueViewIndex++;
                }
                connections[i] = valueViewIndex;
              });
            }
            viewIndex++;
            break;
        }
      });

      view._connections = newConnections;
      view.update = update;
      view.update();
    }
  };

  return ExtenderHelper;
});