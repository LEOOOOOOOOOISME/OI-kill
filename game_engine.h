#pragma once
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <set>
#include <memory>
#include <chrono>
#include <random>
#include <mutex>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// 卡牌类型
enum CardType { BASIC_ATTACK, BASIC_DODGE, BASIC_HEAL, WEAPON, ARMOR,
                MOUNT_OFF, MOUNT_DEF, FUNC, SPECIAL_EASTER };

struct Card {
    int id;
    std::string name;
    std::string suit;   // spade club heart diamond
    int number;
    CardType type;
    bool evolved;
    int targetId;
    Card() : id(0), name(""), suit(""), number(0), type(FUNC), evolved(false), targetId(-1) {}
    Card(int i, const std::string& n, const std::string& s, int num, CardType t)
        : id(i), name(n), suit(s), number(num), type(t), evolved(false), targetId(-1) {}
    std::string symbol() const;
    bool isBlack() const;
    bool isRed() const;
};

struct Player {
    int id = 0;
    std::string name;
    std::string identity;     // Au选手 Ag选手 反贼 摸鱼怪
    std::string profession;   // 9种职业
    int hp = 4, max_hp = 4;
    bool alive = true;
    int depression = 0;             // 颓废标记
    std::vector<Card> hand;
    std::vector<Card> equip;
    Card* weapon = nullptr;
    Card* armor = nullptr;
    Card* mount_off = nullptr;
    Card* mount_def = nullptr;
    bool awakened = false;
    int noDamageRounds = 0;
    int damageDealtThisTurn = 0;
    int skipPlayRounds = 0;
    bool retireUsed = false;
    int preventDamageCount = 0;
    bool usedMentor = false;
    int liveViewCount = 0;
    bool usedSealThisGame = false;
    std::vector<int> evoCandidates;
    int evoTotal = 0;
    int evoTurn = 0;
    int acUsedThisTurn = 0;
    int acLimit = 1;
    bool usedUndefeatedThisTurn = false;
    bool usedKangThisTurn = false;
    std::set<std::string> usedSkillsThisTurn;
    bool bossDmgBoost = false;        // 传奇Au觉醒: 本局剩余时间伤害+1
    bool usedAskThisTurn = false;     // 萌新·问问题: 成为卡牌唯一目标时摸1(每回合限一次)
    bool usedSkirtThisTurn = false;   // 女装大佬·女装: 成为锦囊目标时摸1(每回合限一次)
    bool akioiActive = false;         // 神犇·AKIOI: 本回合已激活(伤害+1)
    int yanyaCountThisTurn = 0;       // 神犇·碾压本回合打出AC数量(觉醒计数)
    bool akAllActive = false;         // 神犇觉醒·AK全场: 下一张AC可指定任意数量目标
    int kachangSuccess = 0;           // 毒瘤·卡常成功次数(觉醒计数)
    bool examThisTurn = false;        // 金牌教练·模拟赛是否已在本回合使用
    bool depressionAsked = false;     // 摸鱼怪·颓废: 本回合是否已询问
    bool skillBlocked = false;        // TLE: 本回合不能使用主动技能
    int handLimitMod = 0;             // MLE: 本回合手牌上限修正(-2)
    bool noTrickThisTurn = false;     // CE: 本回合不能使用锦囊牌
    int teachCount = 0;               // 学长·讲题次数(觉醒计数)
    int judgeDefCount = 0;            // 评测姬·测评防伤次数(觉醒计数)
    int tableCount = 0;               // 打表狂魔·打表次数(觉醒计数)
    bool xuanxueUsedThisTurn = false; // 玄学选手·玄学: 每回合第一次受伤判定
    // ===== v3.0 新字段 =====
    std::vector<Card> delayArea;      // 判定区: 延时锦囊 (UB/水群/断网)
    bool chained = false;             // 链式前向星: 横置状态
    bool coffeeBoost = false;         // 咖啡: 本回合下一张AC伤害+1
    int coffeeBoostDmg = 1;           // 咖啡加成值 (进化后=2)
    // 新职业计数(觉醒)
    int kouhaiCount = 0;              // 键盘侠·口嗨次数
    int chaotijieCount = 0;           // 抄题解选手·抄题解次数
    int yaxianCount = 0;              // 压线选手·压线过触发次数
    int shuiqunCount = 0;             // 水群怪·水群次数
    int baolingCount = 0;             // 爆零选手·爆零次数
    bool usedDianjiThisGame = false;  // 图灵奖得主·奠基(限定技)
    bool yaxianThisTurn = false;      // 压线选手: 每回合限1次压线过
    int handLimitBonus = 0;           // 图灵奖得主: 手牌上限+1(被动), +2奠基后共+3
    bool yunDuanUsed = false;         // 冷数据已用(每次攻击结算用一次)
    bool acBaoHuTriggered = false;    // AC保护: 本回合是否已触发
    bool skipDraw = false;            // 断网: 本回合跳过摸牌阶段
};

struct Pending {
    std::string type;
    int targetPlayer = -1;
    std::vector<int> validCards;
    json context;
    std::chrono::steady_clock::time_point deadline;
};

class Room {
public:
    int id = 0;
    std::vector<Player> players;
    int currentTurn = 0;
    int roundCount = 1;
    int nextCardId = 10000;
    std::vector<Card> deck, discard;
    std::vector<std::string> log;
    std::string activeEvent = "?";
    bool gameOver = false;
    std::string winner;
    int awakeningCount = 0;            // 觉醒次数(用于本局囧闻)

    enum Phase { ROUND_START, JUDGE, DRAW, PLAY, DISCARD, END, GAME_OVER };
    Phase phase = ROUND_START;
    std::unique_ptr<Pending> pending;
    std::string forcedJudgeColor = ""; // 手动测评: 强制下一次判定花色 red/black
    bool banWANextTurn = false;        // 毒瘤觉醒·全员卡常: 其他角色不能使用WA
    std::string banWABy = "";          // 记录发起全员卡常的玩家名(用于回合结束时解除)
    std::vector<int> aoeResponded;     // AOE结算: 已响应过的玩家 (数据加强/评测机抽风)
    int aoeOwner = -1;                 // AOE结算: 使用者
    std::string aoeType = "";          // AOE结算: 数据加强 / 评测机抽风
    int aoeBaseDmg = 1;                // AOE结算: 伤害基数(进化后=2)
    bool aoeActive = false;            // AOE结算进行中

    Player& getPlayer(int pid);
    bool isAlive(int pid) const;
    void addLog(const std::string& msg);
    Card drawCard();
    void shuffleDeck();
    void discardCard(Card& c);
    void discardFromHand(Player& p, int idx);
    int distanceBetween(int from, int to);
    int attackRange(Player& p);
    bool canAttack(int from, int to);
    void equipCard(Player& p, Card& c);
    void loseArmorEffect(Player& p, Card& eq);  // 防具离场效果(AC保护/金牌保护/全员拉黑)
    int dealDamage(Player& source, Player& target, int dmg, bool isAttack, bool isCardEffect = false);
    void checkVictory();
    void clearPending();
    void resolvePendingTimeout(); // 待响应超时自动结算, 防止游戏卡死
    void startResponse(const std::string& type, int target, std::vector<int> valid, json ctx);
    void checkAwakenings();
    void nextPhase();
    void tryEvolutionSelect(Player& p);
    bool useCard(int pid, int cardIdx, std::vector<int> targets, json& result);
    bool useSkill(int pid, const std::string& skill, const json& msg, json& result);
    bool processResponse(int pid, const json& msg, json& result);
    void resetForStart();   // 房间满员时重置对局并开始
    json getStateJson(int viewerId);
    // v3.0: AOE/延时锦囊辅助
    void startAoe(int owner, const std::string& aoeName, int baseDmg);
    void stepAoe();
    void judgeDelayArea(Player& p);   // 结算一名角色的判定区延时锦囊
    bool canUseWA(Player& p);         // 判断能否使用WA(含玄学判题/并查集)
};

std::mt19937& rng();
int randInt(int low, int high);
std::string randSuit();
std::string suitEmoji(const std::string& s);  // 花色 -> ♠♣♥♦
extern std::map<std::string, std::string> evoMap;
