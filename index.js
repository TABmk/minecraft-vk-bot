const { Rcon } = require("rcon-client");
const mysql = require('mysql-await');
const easyvk = require('easyvk');

/**
 * Конфиг из файла config.json
 * @type {Object}
 */
const config = require('./config');

(async () => {
  const MySQL = mysql.createConnection(config.modules.mysql);
  const rcon = new Rcon(config.modules.rcon);
  const vk = await easyvk(config.modules.vk);

  /**
   * Переменна для проверок реконекта, если rcon не работает
   * @type {Boolean}
   */
  let rconConnected = false;

  /**
   * Функция для подключения rcon клиента и отлавливания ошибок
   */
  let connectRcon = () => {
    rcon.connect()
      .catch((e) => {
        console.log(`[RCON] Error, ${e.message}`)
      });
  }

  /**
   * Отправка сообщений в вк
   * @param  {Number} userID
   * @param  {String} msg
   */
  let sendMessage = (userID, msg) => {
    vk.call('messages.send', {
      peer_id: userID,
      message: msg,
      random_id: easyvk.randomId()
    });
  }

  // Отлавливает ошибки mysql клиента
  MySQL.on('error', (err) => {
    console.error(`[MySQL] Error ${err.code}`);
  });

  // Обработка ивентов rcon клиента
  rcon.on('connect', () => {
    rconConnected = true;
    console.log('[RCON] Connected');
  });

  rcon.on('error', () => {
    rconConnected = false;
    console.log('[RCON] Error, restarting...');
  });

  // Попытки переподключения rcon
  setInterval(() => {
    if (!rconConnected) {
      connectRcon();
    }
  }, config.rcon.reconnect_time);

  // Запуск longpoll для вк бота
  const VK = await vk.longpoll.connect();

  // Слушаем ивент на приход сообщений
  VK.on('message', async (msg) => {
    // Этих данных достаточно
    let message = msg[5];
    let userID = msg[3];

    // Регулярка для команды
    let exp = new RegExp(config.command.RegExp, config.command.RegExp_flags);

    // Реагировать только на команду
    if (exp.test(message)) {
      let nickname = message.match(exp);

      /**
       * Изменяет переменные в сообщении на значения
       * @param  {String} msg
       * @return {String}     сообщение с измененными переменными
       */
      const placeholders = (msg) => {
        return msg
        .replace('%vkid%', userID)
        .replace('%nickname%', nickname)
        .replace('%nickname_lower%', nickname.toLowerCase());
      }

      if (typeof nickname[1] !== 'undefined') {
        nickname = nickname[1];

        // Только для теста, используйте на свой страх и риск
        //
        // let isSub = await vk.call('groups.isMember', {
        //   group_id: 123,
        //   user_id: 123,
        // });
        //
        // if (isSub.getFullResponse().response !== 1) {
        //   sendMessage(userID, 'Вы не подписаны на группу!');
        //   return;
        // }

        // Достаем из базы пользователей с таким vkid
        let vkcheck = await MySQL.awaitQuery(
          placeholders(config.sql.check_vkid)
        );

        // Пользователь с этим вк уже получал награду
        if (vkcheck.length) {
          sendMessage(userID, placeholders(config.messages.vkuser_already_rewarded));
          return;
        }

        let mcUser = await MySQL.awaitQuery(
          placeholders(config.sql.check_user)
        );

        // Игрок с этим ником уже получал награду
        if (mcUser.length && typeof mcUser[0].vkid === 'number') {
          sendMessage(userID, placeholders(config.messages.player_already_rewarded));
          return;
        }

        if (!mcUser.length) {
          sendMessage(userID, placeholders(config.messages.player_check_fail));
        } else {
          sendMessage(userID, placeholders(config.messages.success));

          // Привязываем этот вк к этому нику
          await MySQL.awaitQuery(
            placeholders(config.sql.save_vkid)
          );

          // Отправляем награду
          switch (config.reward_type) {
            case 'msg':
              sendMessage(userID, placeholders(config.messages.reward));
              break;
            case 'rcon':
              rcon.send(placeholders(config.rcon.reward));
              break;
            case 'sql':
              MySQL.awaitQuery(placeholders(config.sql.reward));
              break;
          }
        }
      }
    }
  });
})();

console.log(`[minecraft-vk-bot v${require('./package').version} by @TAB_mk] Start`);
